import {
  createPublicClient,
  createWalletClient,
  decodeAbiParameters,
  encodeFunctionData,
  getAbiItem,
  http,
  namehash,
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
import type { OnchainState, RegisterMessage } from "@ketsuban/registrar";
import { bridgeAbi, factoryAbi, registryAbi, resolverAbi } from "./abi.js";
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

  async submit(record: RegisterMessage, signature: Hex): Promise<Hex> {
    const fee = (
      await this.publicClient.readContract({
        address: this.config.MULTIPASS,
        abi: MultipassAbi,
        functionName: "getDomainState",
        args: [record.domainName],
      })
    ).fee;
    const hash = await this.walletClient.writeContract({
      chain: this.walletClient.chain,
      account: this.walletClient.account!,
      address: this.config.BRIDGE,
      abi: bridgeAbi,
      functionName: "verify",
      args: [
        record,
        signature,
        { domainName: zeroHash, wallet: zeroAddress, name: zeroHash, id: zeroHash, targetDomain: zeroHash },
        "0x",
      ],
      value: fee,
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`verify reverted in ${hash}`);
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
  async listRecordsByWallet(wallet: Address): Promise<(ListedRecord & { domain: string })[]> {
    const fromBlock = BigInt(this.config.DEPLOY_BLOCK);
    const logs = await this.publicClient.getLogs({
      address: this.config.MULTIPASS,
      event: getAbiItem({ abi: MultipassAbi, name: "Registered" }),
      fromBlock,
      toBlock: "latest",
    });
    const w = wallet.toLowerCase();
    const seen = new Set<string>();
    const out: (ListedRecord & { domain: string })[] = [];
    for (const l of logs) {
      const rec = l.args.NewRecord;
      if (!rec || rec.wallet.toLowerCase() !== w) continue;
      const domain = fromBytes32(l.args.domainName as Hex);
      const key = `${domain}:${rec.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const [ok, r] = await this.publicClient.readContract({
        address: this.config.MULTIPASS,
        abi: MultipassAbi,
        functionName: "resolveRecord",
        args: [
          {
            name: zeroHash,
            id: rec.id,
            wallet: zeroAddress,
            domainName: l.args.domainName as Hex,
            targetDomain: zeroHash,
          },
        ],
      });
      if (!ok || r.wallet.toLowerCase() !== w) continue;
      out.push({
        domain,
        name: fromBytes32(r.name),
        id: r.id,
        wallet: r.wallet,
        payload: r.payload,
        validUntil: r.validUntil,
        nonce: r.nonce,
        live: r.validUntil > BigInt(Math.floor(Date.now() / 1000)),
      });
    }
    return out;
  }

  /** Every record ever written to `domain` (Registered + Renewed logs), latest state per id, with liveness */
  async listRecords(domain: string): Promise<ListedRecord[]> {
    const domainB = toBytes32(domain);
    const fromBlock = BigInt(this.config.DEPLOY_BLOCK);
    const [registered, renewed] = await Promise.all([
      this.publicClient.getLogs({
        address: this.config.MULTIPASS,
        event: getAbiItem({ abi: MultipassAbi, name: "Registered" }),
        args: { domainName: domainB },
        fromBlock,
        toBlock: "latest",
      }),
      this.publicClient.getLogs({
        address: this.config.MULTIPASS,
        event: getAbiItem({ abi: MultipassAbi, name: "Renewed" }),
        args: { domainName: domainB },
        fromBlock,
        toBlock: "latest",
      }),
    ]);
    const ids = new Set<Hex>();
    for (const l of registered) if (l.args.NewRecord) ids.add(l.args.NewRecord.id);
    for (const l of renewed) if (l.args.id) ids.add(l.args.id);
    const now = BigInt(Math.floor(Date.now() / 1000));
    const out: ListedRecord[] = [];
    for (const id of ids) {
      const [ok, r] = await this.publicClient.readContract({
        address: this.config.MULTIPASS,
        abi: MultipassAbi,
        functionName: "resolveRecord",
        args: [{ name: zeroHash, id, wallet: zeroAddress, domainName: domainB, targetDomain: zeroHash }],
      });
      if (!ok) continue;
      out.push({
        name: fromBytes32(r.name),
        id: r.id,
        wallet: r.wallet,
        payload: r.payload,
        validUntil: r.validUntil,
        nonce: r.nonce,
        live: r.validUntil > now,
      });
    }
    return out.sort((a, b) => Number(b.validUntil - a.validUntil));
  }

  private async wait(hash: Hex) {
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`transaction reverted: ${hash}`);
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
  | "resolveAddr"
  | "resolveData"
  | "relayer"
  | "ensureVouchInstance"
  | "listRecords"
  | "nameStatus"
  | "listRecordsByWallet"
>;
