import {
  createPublicClient,
  createWalletClient,
  decodeAbiParameters,
  encodeFunctionData,
  getAbiItem,
  http,
  namehash,
  toFunctionSelector,
  toHex,
  zeroAddress,
  zeroHash,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { MultipassAbi, fromBytes32, toBytes32 } from "@peeramid-labs/multipass-client";
import { PLATFORM_DOMAIN_NAMES, type OnchainState, type RegisterMessage } from "@ketsuban/registrar";
import { bridgeAbi, factoryAbi, registryAbi, resolverAbi, universalResolverAbi } from "./abi.js";
import { RpcSource } from "./logs.js";
import { Indexer, type IndexStatus, type IndexedRecord } from "./indexer.js";
import { explainRevert } from "./errors.js";
import type { Config } from "./config.js";

/** One Multipass record as seen in Registered/Renewed logs, with its current liveness */
export type ListedRecord = {
  name: string;
  id: Hex;
  wallet: Address;
  payload: Hex;
  validUntil: bigint;
  nonce: bigint;
  live: boolean;
};

export type Instance = {
  domain: string;
  registry: Address;
  resolver: Address;
  parentName: string;
  parentLabel: string;
};

/** DNS-encode a name for ENSIP-10 `resolve(bytes,bytes)` */
export function dnsEncode(name: string): Hex {
  const bytes: number[] = [];
  for (const label of name.split(".")) {
    const l = new TextEncoder().encode(label);
    if (l.length === 0 || l.length > 255) throw new Error(`dnsEncode: bad label "${label}"`);
    bytes.push(l.length, ...l);
  }
  bytes.push(0);
  return toHex(Uint8Array.from(bytes));
}

/** Everything the API reads from or writes to the chain, behind one object so tests can fake it */
export class Chain {
  readonly publicClient: PublicClient;
  readonly indexer: Indexer;
  readonly walletClient: WalletClient;
  readonly relayer: Address;

  constructor(readonly config: Config) {
    const transport = http(config.RPC_URL);
    const chain = {
      id: config.CHAIN_ID,
      name: "configured",
      nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [config.RPC_URL] } },
    };
    const account = privateKeyToAccount(config.RELAYER_KEY);
    this.relayer = account.address;
    this.publicClient = createPublicClient({ chain, transport });
    this.walletClient = createWalletClient({ chain, transport, account });
    this.indexer = new Indexer(
      new RpcSource(this.publicClient, BigInt(config.RPC_LOG_WINDOW)),
      config.MULTIPASS,
      BigInt(config.DEPLOY_BLOCK),
      { dataDir: config.DATA_DIR || undefined }
    );
  }

  async readOnchain(wallet: Address, domain: string): Promise<OnchainState> {
    const [exists, record] = await this.publicClient.readContract({
      address: this.config.MULTIPASS,
      abi: MultipassAbi,
      functionName: "resolveRecord",
      args: [{ name: zeroHash, id: zeroHash, wallet, domainName: toBytes32(domain), targetDomain: zeroHash }],
    });
    return { exists, nonce: record.nonce, id: record.id, wallet: record.wallet };
  }

  async instances(): Promise<Instance[]> {
    const domains = await this.publicClient.readContract({
      address: this.config.FACTORY,
      abi: factoryAbi,
      functionName: "domains",
    });
    return Promise.all(
      domains.map(async (d) => {
        const i = await this.publicClient.readContract({
          address: this.config.FACTORY,
          abi: factoryAbi,
          functionName: "instance",
          args: [d],
        });
        return {
          domain: fromBytes32(d),
          registry: i.registry,
          resolver: i.resolver,
          parentName: i.parentName,
          parentLabel: i.parentLabel,
        };
      })
    );
  }

  /**
   * Relay a registrar-signed record. Multipass splits registration from renewal and `register` reverts
   * with `recordExists` on a second write, so the route depends on what is already there: a first
   * record goes through the bridge, which also grants the wallet its profile keys, and a renewal goes
   * straight to Multipass, which needs no privileges and leaves those grants alone.
   */
  async submit(record: RegisterMessage, signature: Hex): Promise<Hex> {
    const query = {
      domainName: record.domainName,
      wallet: zeroAddress,
      name: zeroHash,
      id: record.id,
      targetDomain: zeroHash,
    } as const;
    const [[exists], domain] = await Promise.all([
      this.publicClient.readContract({
        address: this.config.MULTIPASS,
        abi: MultipassAbi,
        functionName: "resolveRecord",
        args: [query],
      }),
      this.publicClient.readContract({
        address: this.config.MULTIPASS,
        abi: MultipassAbi,
        functionName: "getDomainState",
        args: [record.domainName],
      }),
    ]);
    const common = { chain: this.walletClient.chain, account: this.walletClient.account! } as const;
    // Multipass's reverts are custom errors on a contract this ABI does not describe, so decode them
    // here rather than handing a bare selector to whoever is trying to publish.
    const hash = await this.explaining(() =>
      exists
        ? this.walletClient.writeContract({
            ...common,
            address: this.config.MULTIPASS,
            abi: MultipassAbi,
            functionName: "renewRecord",
            args: [query, record, signature],
            value: domain.renewalFee,
          })
        : this.walletClient.writeContract({
            ...common,
            address: this.config.BRIDGE,
            abi: bridgeAbi,
            functionName: "verify",
            args: [
              record,
              signature,
              {
                domainName: zeroHash,
                wallet: zeroAddress,
                name: zeroHash,
                id: zeroHash,
                targetDomain: zeroHash,
              },
              "0x",
            ],
            value: domain.fee,
          })
    );
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`verify reverted in ${hash}`);
    // Read-your-writes: the record this call created must be visible to the next request.
    await this.indexer
      .catchUp(receipt.blockNumber)
      .catch((err) => console.error(`index catch-up failed · ${err.message}`));
    return hash;
  }

  /**
   * Provision the per-candidate vouch instance `<prefix><handle>` beneath the root registry:
   * Multipass domain (registrar signs, fee 0) → factory.create → root.setSubregistry. Idempotent.
   * Needs the relayer to own Multipass, the factory and the root registry.
   */
  async ensureVouchInstance(handle: string): Promise<{ domain: string; created: boolean }> {
    const domain = `${this.config.VOUCH_PREFIX}${handle}`;
    const domainB = toBytes32(domain);
    const exists = await this.publicClient.readContract({
      address: this.config.FACTORY,
      abi: factoryAbi,
      functionName: "isInstance",
      args: [domainB],
    });
    if (exists) return { domain, created: false };
    const { REGISTRY, PERMISSIONED_RESOLVER, REGISTRAR_ADDRESS } = this.config;
    if (!REGISTRY || !PERMISSIONED_RESOLVER || !REGISTRAR_ADDRESS)
      throw new Error("vouch instances need REGISTRY, PERMISSIONED_RESOLVER and REGISTRAR_ADDRESS");
    const rootParent = (await this.instances()).find(
      (i) => i.registry.toLowerCase() === REGISTRY.toLowerCase()
    )?.parentName;
    if (!rootParent) throw new Error("root registry is not a known instance");
    const w = { chain: this.walletClient.chain, account: this.walletClient.account! };
    const mpState = await this.publicClient.readContract({
      address: this.config.MULTIPASS,
      abi: MultipassAbi,
      functionName: "getDomainState",
      args: [domainB],
    });
    if (mpState.name === zeroHash) {
      await this.wait(
        await this.walletClient.writeContract({
          ...w,
          address: this.config.MULTIPASS,
          abi: MultipassAbi,
          functionName: "initializeDomain",
          args: [REGISTRAR_ADDRESS, 0n, 0n, domainB, 0n, 0n],
        })
      );
    }
    if (!mpState.isActive) {
      await this.wait(
        await this.walletClient.writeContract({
          ...w,
          address: this.config.MULTIPASS,
          abi: MultipassAbi,
          functionName: "activateDomain",
          args: [domainB],
        })
      );
    }
    await this.wait(
      await this.walletClient.writeContract({
        ...w,
        address: this.config.FACTORY,
        abi: factoryAbi,
        functionName: "create",
        args: [domainB, REGISTRY, handle, `${handle}.${rootParent}`, PERMISSIONED_RESOLVER],
      })
    );
    const inst = await this.publicClient.readContract({
      address: this.config.FACTORY,
      abi: factoryAbi,
      functionName: "instance",
      args: [domainB],
    });
    await this.wait(
      await this.walletClient.writeContract({
        ...w,
        address: REGISTRY,
        abi: registryAbi,
        functionName: "setSubregistry",
        args: [handle, inst.registry],
      })
    );
    return { domain, created: true };
  }

  /** Whether `handle` is taken in `domain`, and by which wallet */
  async nameStatus(
    domain: string,
    handle: string
  ): Promise<{ taken: boolean; wallet: Address | null; live: boolean }> {
    const [ok, r] = await this.publicClient.readContract({
      address: this.config.MULTIPASS,
      abi: MultipassAbi,
      functionName: "resolveRecord",
      args: [
        {
          name: toBytes32(handle),
          id: zeroHash,
          wallet: zeroAddress,
          domainName: toBytes32(domain),
          targetDomain: zeroHash,
        },
      ],
    });
    const live = ok && r.validUntil > BigInt(Math.floor(Date.now() / 1000));
    return { taken: ok, wallet: ok ? r.wallet : null, live };
  }

  /** Every record a wallet has registered (any domain), current state, with liveness */
  /**
   * Can this service write a record in `domain` at all? Read before the wallet signs: a domain that
   * was never initialised, or one whose registrar is not the key this service signs with, fails after
   * the signature otherwise — which is the worst moment to find out.
   */
  async domainReady(
    domain: string
  ): Promise<{ initialised: boolean; active: boolean; registrarOk: boolean }> {
    const d = await this.publicClient.readContract({
      address: this.config.MULTIPASS,
      abi: MultipassAbi,
      functionName: "getDomainState",
      args: [toBytes32(domain)],
    });
    const signsAs = this.config.REGISTRAR_KEY
      ? privateKeyToAccount(this.config.REGISTRAR_KEY).address
      : this.config.REGISTRAR_ADDRESS;
    return {
      initialised: d.name !== zeroHash,
      active: d.isActive,
      // Without a configured registrar this service does not sign; the enclave does, and only the
      // chain knows whether that key matches.
      registrarOk: !signsAs || d.registrar.toLowerCase() === signsAs.toLowerCase(),
    };
  }

  /**
   * Check the deployment this service is pointed at, not a freshly deployed copy of the source. A
   * contract can be missing the function we call — the live bridge predates more than one of them —
   * and a domain can be inactive or held by a different registrar. Both fail at the worst moment
   * otherwise: when a user signs something.
   */
  async preflight(): Promise<Preflight> {
    const warnings: string[] = [];
    const [bridgeCode, multipassCode, factoryCode] = await Promise.all([
      this.publicClient.getCode({ address: this.config.BRIDGE }),
      this.publicClient.getCode({ address: this.config.MULTIPASS }),
      this.publicClient.getCode({ address: this.config.FACTORY }),
    ]);
    const deployed = (code: Hex | undefined) => !!code && code !== "0x";
    if (!deployed(bridgeCode)) warnings.push(`BRIDGE ${this.config.BRIDGE} has no code`);
    if (!deployed(multipassCode)) warnings.push(`MULTIPASS ${this.config.MULTIPASS} has no code`);
    if (!deployed(factoryCode)) warnings.push(`FACTORY ${this.config.FACTORY} has no code`);

    // solc puts every external selector in the dispatch table, so its absence from the bytecode means
    // the deployed contract simply does not have that function.
    const calls = ["verify", "linkOwnName"] as const;
    const missing = calls.filter(
      (fn) =>
        deployed(bridgeCode) &&
        !bridgeCode!.includes(toFunctionSelector(getAbiItem({ abi: bridgeAbi, name: fn })).slice(2))
    );
    for (const fn of missing) warnings.push(`BRIDGE has no ${fn}(): it predates this build`);

    // Platform domains matter as much as name domains: Multipass reverts with `invalidDomain` on an
    // uninitialised one, and the user only finds out after signing.
    const wanted = [...this.config.NAME_DOMAINS, ...PLATFORM_DOMAIN_NAMES];
    const domains = await Promise.all(
      wanted.map(async (domain) => {
        const d = await this.publicClient.readContract({
          address: this.config.MULTIPASS,
          abi: MultipassAbi,
          functionName: "getDomainState",
          args: [toBytes32(domain)],
        });
        const registrar = d.registrar;
        if (d.name === zeroHash) warnings.push(`domain "${domain}" is not initialised on Multipass`);
        else if (!d.isActive) warnings.push(`domain "${domain}" is not active on Multipass`);
        if (
          d.name !== zeroHash &&
          this.config.REGISTRAR_ADDRESS &&
          registrar.toLowerCase() !== this.config.REGISTRAR_ADDRESS.toLowerCase()
        ) {
          warnings.push(
            `domain "${domain}" registrar is ${registrar}, not the configured ${this.config.REGISTRAR_ADDRESS}`
          );
        }
        return {
          domain,
          initialised: d.name !== zeroHash,
          active: d.isActive,
          registrar,
          fee: d.fee.toString(),
          renewalFee: d.renewalFee.toString(),
        };
      })
    );

    // The registrar key has to be the key Multipass expects, or every signature this service makes is
    // rejected after the user has already signed theirs.
    const configuredRegistrar = this.config.REGISTRAR_KEY
      ? privateKeyToAccount(this.config.REGISTRAR_KEY).address
      : this.config.REGISTRAR_ADDRESS;
    const onchainRegistrars = [...new Set(domains.filter((d) => d.initialised).map((d) => d.registrar))];
    if (configuredRegistrar && onchainRegistrars.length > 0) {
      const wrong = onchainRegistrars.filter((r) => r.toLowerCase() !== configuredRegistrar.toLowerCase());
      if (wrong.length > 0) {
        warnings.push(
          `registrar mismatch: this service signs as ${configuredRegistrar}, Multipass expects ${wrong.join(", ")}`
        );
      }
    }

    const relayerBalance = await this.balance(this.relayer);
    if (relayerBalance < this.config.RELAYER_MIN_WEI) {
      warnings.push(
        `relayer ${this.relayer} holds ${relayerBalance} wei, below the ${this.config.RELAYER_MIN_WEI} minimum`
      );
    }

    const instances = (await this.instances()).map((i) => i.domain);
    for (const domain of this.config.NAME_DOMAINS) {
      if (!instances.includes(domain)) warnings.push(`domain "${domain}" has no instance in the factory`);
    }

    return {
      ok: warnings.length === 0,
      bridge: { address: this.config.BRIDGE, deployed: deployed(bridgeCode), missing },
      multipass: { address: this.config.MULTIPASS, deployed: deployed(multipassCode), domains },
      factory: { address: this.config.FACTORY, deployed: deployed(factoryCode), instances },
      registrar: { signsAs: configuredRegistrar ?? null, onchain: onchainRegistrars },
      relayer: { address: this.relayer, balance: relayerBalance.toString() },
      warnings,
    };
  }

  balance(wallet: Address): Promise<bigint> {
    return this.publicClient.getBalance({ address: wallet });
  }

  /** Plain ETH transfer from the relayer; throws when the receipt is not successful. */
  async sendEth(to: Address, value: bigint): Promise<Hex> {
    const hash = await this.walletClient.sendTransaction({
      chain: this.walletClient.chain,
      account: this.walletClient.account!,
      to,
      value,
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`gas top-up ${hash} reverted`);
    return hash;
  }

  /** Records this wallet holds, from the index. */
  async listRecordsByWallet(wallet: Address): Promise<(ListedRecord & { domain: string })[]> {
    return this.indexer.recordsByWallet(wallet).map(toListed);
  }

  /** Every record in `domain`, latest state per id, newest expiry first. */
  async listRecords(domain: string): Promise<ListedRecord[]> {
    return this.indexer.recordsByDomain(domain).map(toListed);
  }

  indexStatus(): IndexStatus {
    return this.indexer.status();
  }

  /**
   * Wait for the receipt, then read the new blocks: a record this service just wrote must be visible
   * to the request that follows it, not only after the next poll.
   */
  /** Run a chain write, replacing a raw revert selector with the rule that failed. */
  private async explaining<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (err) {
      throw new Error(explainRevert(err));
    }
  }

  private async wait(hash: Hex) {
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`transaction reverted: ${hash}`);
    await this.indexer
      .catchUp(receipt.blockNumber)
      .catch((err) => console.error(`index catch-up failed · ${err.message}`));
  }

  /**
   * Read a name the way any ENS client does: through the ENSv2 UniversalResolver, which walks the
   * registry itself. Nothing here depends on our own instance bookkeeping, which is the point.
   */
  async resolveUniversal(
    name: string,
    keys: string[]
  ): Promise<{ resolver: Address; addr: Address; texts: Record<string, string> }> {
    const universal = this.config.UNIVERSAL_RESOLVER;
    if (!universal) throw new Error("UNIVERSAL_RESOLVER is not configured");
    const node = namehash(name);
    const dns = dnsEncode(name);
    const read = (data: Hex) =>
      this.publicClient.readContract({
        address: universal,
        abi: universalResolverAbi,
        functionName: "resolve",
        args: [dns, data],
      });
    const [[addrOut, resolver], ...textOuts] = await Promise.all([
      read(encodeFunctionData({ abi: resolverAbi, functionName: "addr", args: [node] })),
      ...keys.map((key) =>
        read(encodeFunctionData({ abi: resolverAbi, functionName: "text", args: [node, key] }))
      ),
    ]);
    const texts: Record<string, string> = {};
    keys.forEach((key, i) => {
      texts[key] = decodeAbiParameters([{ type: "string" }], textOuts[i][0])[0];
    });
    return { resolver, addr: decodeAbiParameters([{ type: "address" }], addrOut)[0], texts };
  }

  /** ENSIP-10 read through the instance resolver */
  async resolveText(resolver: Address, name: string, key: string): Promise<string> {
    const out = await this.publicClient.readContract({
      address: resolver,
      abi: resolverAbi,
      functionName: "resolve",
      args: [
        dnsEncode(name),
        encodeFunctionData({ abi: resolverAbi, functionName: "text", args: [namehash(name), key] }),
      ],
    });
    return decodeAbiParameters([{ type: "string" }], out)[0];
  }

  async resolveAddr(resolver: Address, name: string): Promise<Address> {
    const out = await this.publicClient.readContract({
      address: resolver,
      abi: resolverAbi,
      functionName: "resolve",
      args: [
        dnsEncode(name),
        encodeFunctionData({ abi: resolverAbi, functionName: "addr", args: [namehash(name)] }),
      ],
    });
    return decodeAbiParameters([{ type: "address" }], out)[0];
  }

  async resolveData(resolver: Address, name: string, key: string): Promise<Hex> {
    const out = await this.publicClient.readContract({
      address: resolver,
      abi: resolverAbi,
      functionName: "resolve",
      args: [
        dnsEncode(name),
        encodeFunctionData({ abi: resolverAbi, functionName: "data", args: [namehash(name), key] }),
      ],
    });
    return decodeAbiParameters([{ type: "bytes" }], out)[0];
  }
}

export type ChainReader = Pick<
  Chain,
  | "readOnchain"
  | "instances"
  | "submit"
  | "resolveText"
  | "resolveUniversal"
  | "resolveAddr"
  | "resolveData"
  | "relayer"
  | "ensureVouchInstance"
  | "listRecords"
  | "nameStatus"
  | "listRecordsByWallet"
  | "balance"
  | "sendEth"
  | "indexStatus"
  | "preflight"
  | "domainReady"
>;

function toListed(r: IndexedRecord): ListedRecord & { domain: string } {
  return {
    domain: r.domain,
    name: r.name,
    id: r.id,
    wallet: r.wallet,
    payload: r.payload,
    validUntil: r.validUntil,
    nonce: r.nonce,
    live: r.validUntil > BigInt(Math.floor(Date.now() / 1000)),
  };
}

export type Preflight = {
  ok: boolean;
  bridge: { address: Address; deployed: boolean; missing: string[] };
  multipass: {
    address: Address;
    deployed: boolean;
    domains: {
      domain: string;
      initialised: boolean;
      active: boolean;
      registrar: Address;
      fee: string;
      renewalFee: string;
    }[];
  };
  factory: { address: Address; deployed: boolean; instances: string[] };
  registrar: { signsAs: Address | null; onchain: Address[] };
  relayer: { address: Address; balance: string };
  warnings: string[];
};
