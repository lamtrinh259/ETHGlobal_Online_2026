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
import {
  answerDomain,
  answerOf,
  answerSlug,
  groupingFor,
  isDnsName,
  PLATFORM_DOMAIN_NAMES,
  platformOf,
  type OnchainState,
  type RegisterMessage,
} from "@ketsuban/registrar";
import groupingRegistry from "@ketsuban/contracts/GroupingRegistry" with { type: "json" };
import {
  bridgeAbi,
  ethRegistryAbi,
  factoryAbi,
  registryAbi,
  resolverAbi,
  rootResolverAbi,
  universalResolverAbi,
} from "./abi.js";
import { RpcSource } from "./logs.js";
import { Indexer, type IndexStatus, type IndexedRecord } from "./indexer.js";
import { explainRevert } from "./errors.js";
import type { Config } from "./config.js";

/** One Multipass record as seen in Registered/Renewed logs, with its current liveness */
export type ListedRecord = {
  name: string;
  /** The name as the chain holds it; a masked name does not survive being decoded */
  rawName?: Hex;
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
  /** Where a masked record in this domain is named, when the deployment has a private branch */
  maskedParentName?: string;
  /** The resolver that answers there */
  maskedResolver?: Address;
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
/**
 * Whether a signature this service makes will be accepted at all.
 *
 * A record is signed over an EIP-712 domain built from configuration, and Multipass checks it against
 * the one it was deployed with. Disagree on a character of the name or the version and every
 * attestation reverts at `register` — after the person has already signed, which reads as a broken
 * product rather than as a wrong setting. The contract publishes its own domain, so this is a question
 * with an answer rather than an assumption.
 */
/**
 * Whether one stolen key would be enough to delete a record.
 *
 * The Multipass owner can `deleteName` any record in any domain — the product's central claim is that a
 * reference cannot be deleted, and this is the one key that can. Held by the relayer it is a hot key:
 * it signs transactions continuously, so it is the likeliest of the deployment's keys to be taken, and
 * taking it would buy far more than the gas in it.
 */
export function ownershipWarnings(relayer: Address, owner: Address): string[] {
  if (owner.toLowerCase() !== relayer.toLowerCase()) return [];
  // Said with the trade-off: this deployment provisions a candidate's vouch domain from the relayer,
  // and `initializeDomain` is an owner call, so the relayer owns Multipass on purpose. The fix is a
  // separate owner signer for that one call, then transfer ownership; until then this is the risk.
  return [
    `the Multipass owner is the relayer key (${owner}): the key that signs transactions can also ` +
      `delete any record, so one compromise removes references this deployment calls permanent. ` +
      `It owns Multipass because provisioning a vouch domain is an owner call; the fix is a separate ` +
      `owner signer for that call, then transfer ownership to a key that signs nothing else`,
  ];
}

export function eip712Warnings(
  config: Pick<Config, "MULTIPASS" | "MULTIPASS_EIP712_NAME" | "MULTIPASS_EIP712_VERSION" | "CHAIN_ID">,
  onchain: [Hex, string, string, bigint, Address, Hex, bigint[]]
): string[] {
  const [, name, version, chainId, verifyingContract] = onchain;
  const out: string[] = [];
  if (name !== config.MULTIPASS_EIP712_NAME || version !== config.MULTIPASS_EIP712_VERSION) {
    out.push(
      `MULTIPASS_EIP712_NAME/VERSION is "${config.MULTIPASS_EIP712_NAME}"/"${config.MULTIPASS_EIP712_VERSION}" ` +
        `but the contract signs as "${name}"/"${version}": every record this service signs would be rejected`
    );
  }
  if (
    chainId !== BigInt(config.CHAIN_ID) ||
    verifyingContract.toLowerCase() !== config.MULTIPASS.toLowerCase()
  ) {
    out.push(
      `Multipass signs for chain ${chainId} at ${verifyingContract}, not chain ${config.CHAIN_ID} at ` +
        `${config.MULTIPASS}: every record this service signs would be rejected`
    );
  }
  return out;
}

export class Chain {
  readonly publicClient: PublicClient;
  readonly indexer: Indexer;
  readonly walletClient: WalletClient;
  readonly relayer: Address;
  private mounts?: { at: number; value: Instance[] };
  /** The root name, once read off the root resolver; it cannot change under a deployment. */
  private root?: string;

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
      { dataDir: config.DATA_DIR || undefined, window: BigInt(config.RPC_LOG_WINDOW) * 5n }
    );
  }

  /**
   * Delete a wallet's record in a domain. A Multipass owner call — this deployment's relayer owns
   * Multipass, which the preflight warns about — used by the demo-only admin reset and nothing else.
   * Multipass keeps the record's nonce, so a record written afterwards must sign above it.
   */
  async deleteRecord(domain: string, wallet: Address): Promise<Hex> {
    const common = { chain: this.walletClient.chain, account: this.walletClient.account! } as const;
    return this.explaining(() =>
      this.walletClient.writeContract({
        ...common,
        address: this.config.MULTIPASS,
        abi: MultipassAbi,
        functionName: "deleteName",
        args: [
          { domainName: toBytes32(domain), wallet, name: zeroHash, id: zeroHash, targetDomain: zeroHash },
        ],
      })
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

  /**
   * Every mount this deployment has, read from whatever holds the tree.
   *
   * With one wildcard resolver at the root, Multipass is the tree: a domain's mount is the name rule
   * applied to its name, and nothing was deployed to record it. Otherwise the factories hold it — a
   * deployment can run two, the one that made the root instance and a later one carrying the DNS
   * namespace, which the first is too old to build. The later factory wins for a domain both know,
   * and only it answers about private mirrors.
   */
  async instances(): Promise<Instance[]> {
    // Reading the mounts costs two calls per domain, and every page asks. They change when something
    // is provisioned, which is when this is cleared, so a short reuse is free correctness.
    const fresh = this.mounts && Date.now() - this.mounts.at < this.config.MOUNT_CACHE_SECONDS * 1000;
    if (fresh && this.mounts) return this.mounts.value;
    const root = this.config.ROOT_RESOLVER;
    const value = root ? await this.instancesFromMultipass(root) : await this.instancesFromFactories();
    this.mounts = { at: Date.now(), value };
    return value;
  }

  private async instancesFromFactories(): Promise<Instance[]> {
    const factories = [this.config.FACTORY, this.config.NAMESPACE_FACTORY].filter((a): a is Address => !!a);
    const found = new Map<string, Instance>();
    for (const factory of factories) {
      for (const instance of await this.instancesOf(factory)) found.set(instance.domain, instance);
    }
    return [...found.values()];
  }

  /**
   * The tree as Multipass holds it: every active domain, mounted where the root resolver would answer
   * for it. A domain whose name fits none of the shapes the resolver knows — the humanity and
   * organisation domains, or anything an operator initialised by hand — is left out rather than given
   * a name nothing resolves at.
   */
  private async instancesFromMultipass(resolver: Address): Promise<Instance[]> {
    const [rootName, count] = await Promise.all([
      this.rootName(resolver),
      this.publicClient.readContract({
        address: this.config.MULTIPASS,
        abi: MultipassAbi,
        functionName: "getContractState",
      }),
    ]);
    // Domains are numbered from one: `_initializeDomain` writes at `numDomains + 1`, so index 0 is
    // never a domain and `getContractState` is the last index rather than a length.
    const states = await Promise.all(
      Array.from({ length: Number(count) }, (_, i) =>
        this.publicClient.readContract({
          address: this.config.MULTIPASS,
          abi: MultipassAbi,
          functionName: "getDomainStateById",
          args: [BigInt(i + 1)],
        })
      )
    );
    const found: Instance[] = [];
    for (const state of states) {
      // An inactive domain takes no records, so it is not a mount: the resolver answers nothing there.
      if (!state.isActive) continue;
      const domain = fromBytes32(state.name);
      const mount = domain ? this.mountUnderRoot(domain, rootName) : undefined;
      if (!domain || !mount) continue;
      found.push({
        domain,
        // Nothing is registered per mount any more, and every name under the root is answered by the
        // one resolver — including the masked branch, which is a path rather than a contract.
        registry: zeroAddress,
        resolver,
        ...mount,
        ...(mount.maskedParentName ? { maskedResolver: resolver } : {}),
      });
    }
    return found;
  }

  /**
   * Where a Multipass domain is named under the root, or nothing when the root resolver would not
   * answer for it. This is the same rule the resolver walks in reverse: it takes a name apart into a
   * label and a path and asks Multipass for the path's domain, so a mount is that path plus the root.
   */
  private mountUnderRoot(
    domain: string,
    rootName: string
  ): Pick<Instance, "parentName" | "parentLabel" | "maskedParentName"> | undefined {
    const { NAME_DOMAINS, VOUCH_PREFIX, HUMANITY_DOMAIN, ORG_DOMAIN } = this.config;
    // Both hold records read by wallet from elsewhere in the tree; neither is a name anybody holds.
    if (domain === HUMANITY_DOMAIN || domain === ORG_DOMAIN) return undefined;
    // The first name domain is the root itself: `alice` there is `alice.<root>`, with no path.
    if (domain === NAME_DOMAINS[0])
      return { parentName: rootName, parentLabel: rootName.split(".")[0] ?? rootName };
    if (NAME_DOMAINS.includes(domain)) return { parentName: `${domain}.${rootName}`, parentLabel: domain };
    if (domain.startsWith(VOUCH_PREFIX) && domain.length > VOUCH_PREFIX.length) {
      // A candidate's references hang under the candidate's own name, not under the prefix.
      const handle = domain.slice(VOUCH_PREFIX.length);
      return { parentName: `${handle}.${rootName}`, parentLabel: handle };
    }
    if (isDnsName(domain)) {
      const group = groupingFor(platformOf(domain) ?? "email");
      const labels = domain.toLowerCase().split(".");
      const reversed = [...labels].reverse();
      return {
        parentName: [...reversed, group.open, rootName].join("."),
        parentLabel: labels[labels.length - 1] as string,
        maskedParentName: [...reversed, group.masked, rootName].join("."),
      };
    }
    const answer = answerOf(domain);
    // Round-tripped rather than trusted: only a domain this service could have written is a mount.
    if (answer && answerDomain(answer.question, answer.answer) === domain)
      return {
        parentName: `${answer.answer}.${answer.question}.${rootName}`,
        parentLabel: answer.answer,
      };
    return undefined;
  }

  /**
   * The name this deployment's tree hangs under, read from the resolver that owns it. Immutable on the
   * contract, so it is read once and kept: every mount's name is built from it.
   */
  private async rootName(resolver: Address): Promise<string> {
    if (this.root === undefined) {
      this.root = await this.publicClient.readContract({
        address: resolver,
        abi: rootResolverAbi,
        functionName: "rootName",
      });
    }
    return this.root;
  }

  /**
   * What the `.eth` registry says answers for a label, if anything. A zero answer is not a correction:
   * not every instance is registered there, and the factory's address is right for those.
   */
  private async resolverFromRegistry(label: string): Promise<Address | undefined> {
    if (!this.config.ETH_REGISTRY || !label) return undefined;
    try {
      const found = await this.publicClient.readContract({
        address: this.config.ETH_REGISTRY,
        abi: ethRegistryAbi,
        functionName: "getResolver",
        args: [label],
      });
      return found && found !== zeroAddress ? found : undefined;
    } catch {
      // A registry that cannot answer leaves the factory's record standing, which is what it was.
      return undefined;
    }
  }

  /** Forget the cached mounts: something was just provisioned and the next read must see it. */
  private mountsChanged(): void {
    this.mounts = undefined;
  }

  private async instancesOf(factory: Address): Promise<Instance[]> {
    const domains = await this.publicClient.readContract({
      address: factory,
      abi: factoryAbi,
      functionName: "domains",
    });
    return Promise.all(
      domains.map(async (d) => {
        const [i, masked] = await Promise.all([
          this.publicClient.readContract({
            address: factory,
            abi: factoryAbi,
            functionName: "instance",
            args: [d],
          }),
          this.publicClient
            .readContract({ address: factory, abi: factoryAbi, functionName: "mirror", args: [d] })
            .catch(() => undefined),
        ]);
        // Replacing a resolver changes the registry's pointer; the factory keeps the address it
        // recorded when the instance was made. ENS resolves through the registry's, so a record
        // written on the live resolver is invisible to anything reading the factory's copy.
        const live = await this.resolverFromRegistry(i.parentLabel);
        return {
          domain: fromBytes32(d),
          registry: i.registry,
          resolver: live ?? i.resolver,
          parentName: i.parentName,
          parentLabel: i.parentLabel,
          ...(masked && masked.registry !== zeroAddress
            ? { maskedParentName: masked.parentName, maskedResolver: masked.resolver }
            : {}),
        };
      })
    );
  }

  /**
   * Who owns a `.eth` label on the ENSv2 registry the bridge checks. `linkOwnName` reverts with
   * `NotNameOwner` for anyone else, and a name registered on a different deployment is simply not here,
   * so the answer is worth having before a wallet is asked to sign.
   */
  async ethLabelOwner(label: string): Promise<Address | undefined> {
    if (!this.config.ETH_REGISTRY) return undefined;
    return (await this.publicClient.readContract({
      address: this.config.ETH_REGISTRY,
      abi: registryAbi,
      functionName: "findOwner",
      args: [label],
    })) as Address;
  }

  /**
   * Relay a registrar-signed record. Multipass splits registration from renewal and `register` reverts
   * with `recordExists` on a second write, so the route depends on what is already there: a first
   * record goes through the bridge, which also grants the wallet its profile keys, and a renewal goes
   * straight to Multipass, which needs no privileges and leaves those grants alone.
   */
  async submit(record: RegisterMessage, signature: Hex, description?: string): Promise<Hex> {
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
        : description
          ? // The letter rides in the same transaction: the bridge writes it as `description` on the
            // name the record creates, so a wallet with no gas is not asked for a second transaction.
            this.walletClient.writeContract({
              ...common,
              address: this.config.BRIDGE,
              abi: bridgeAbi,
              functionName: "verifyWithText",
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
                "description",
                description,
              ],
              value: domain.fee,
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
    // With the resolver at the root, `alice.<root>` is answered from `~alice` by the name rule alone:
    // the domain existing is the whole mount, and there is no registry to point anywhere.
    if (this.config.ROOT_RESOLVER) return this.ensureRootDomain(domain);
    const { REGISTRY } = this.config;
    if (!REGISTRY)
      throw new Error("vouch instances need REGISTRY, PERMISSIONED_RESOLVER and REGISTRAR_ADDRESS");
    const rootParent = (await this.instances()).find(
      (i) => i.registry.toLowerCase() === REGISTRY.toLowerCase()
    )?.parentName;
    if (!rootParent) throw new Error("root registry is not a known instance");
    return this.ensureChildInstance({
      domain,
      label: handle,
      parentRegistry: REGISTRY,
      parentName: rootParent,
    });
  }

  /**
   * The namespace everyone who gave one answer shares.
   *
   * Multipass keys a record by its domain, so "everyone who said `dictator`" is a domain of its own,
   * mounted beneath the question it answers: `dictator.kju-is.<root>`. Two people answering the same
   * thing are then two records in one domain rather than two claims on one name.
   */
  async ensureAnswerInstance(
    question: string,
    answer: string
  ): Promise<{ domain: string; created: boolean }> {
    const slug = answerSlug(answer);
    const domain = answerDomain(question, answer);
    if (!slug || !domain) throw new Error(`"${answer}" cannot be an answer namespace: it has no label`);
    const parent = (await this.instances()).find((i) => i.domain === question);
    if (!parent) throw new Error(`no instance called "${question}" to hang an answer under`);
    // The mount is the domain: `dictator.kju-is.<root>` is what the root resolver reads `kju-is:dictator`
    // as, so there is nothing to deploy and nothing to point at it.
    if (this.config.ROOT_RESOLVER) return this.ensureRootDomain(domain);
    return this.ensureChildInstance({
      domain,
      label: slug,
      parentRegistry: parent.registry,
      parentName: parent.parentName,
    });
  }

  /**
   * Create one instance beneath another, and point the parent registry at it.
   *
   * Shared by every namespace that hangs off a name rather than a DNS path — a candidate's vouch
   * domain and an answer's — because when those were written twice they drifted, and the difference
   * only showed up as a revert on someone else's write.
   */
  private async ensureChildInstance(opts: {
    domain: string;
    label: string;
    parentRegistry: Address;
    parentName: string;
  }): Promise<{ domain: string; created: boolean }> {
    const { domain, label, parentRegistry, parentName } = opts;
    const domainB = toBytes32(domain);
    // The bridge grants text-record roles by consulting its own factory. A namespace built by a newer
    // factory would be invisible there, so these belong in the bridge's.
    const factory = this.config.FACTORY;
    const known = await this.publicClient.readContract({
      address: factory,
      abi: factoryAbi,
      functionName: "isInstance",
      args: [domainB],
    });
    if (known) return { domain, created: false };

    const { PERMISSIONED_RESOLVER, REGISTRAR_ADDRESS } = this.config;
    if (!PERMISSIONED_RESOLVER || !REGISTRAR_ADDRESS)
      throw new Error("child instances need REGISTRY, PERMISSIONED_RESOLVER and REGISTRAR_ADDRESS");

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
        address: factory,
        abi: factoryAbi,
        functionName: "create",
        args: [domainB, parentRegistry, label, `${label}.${parentName}`, PERMISSIONED_RESOLVER],
      })
    );
    const inst = await this.publicClient.readContract({
      address: factory,
      abi: factoryAbi,
      functionName: "instance",
      args: [domainB],
    });
    await this.wait(
      await this.walletClient.writeContract({
        ...w,
        address: parentRegistry,
        abi: registryAbi,
        functionName: "setSubregistry",
        args: [label, inst.registry],
      })
    );
    this.mountsChanged();
    return { domain, created: true };
  }

  /**
   * Mount a DNS domain that nobody has deployed yet: the grouping levels it needs, its instance in the
   * open branch, and its mirror in the private one. A person with an address at a mail host nobody
   * anticipated should not be told to come back later, so the relay builds the namespace on demand, the
   * same way it provisions a candidate's vouch instance.
   *
   * Idempotent and safe to call for a domain that already exists: every step checks first.
   */
  async ensureNamespace(domain: string): Promise<{ domain: string; created: boolean; parentName: string }> {
    const rootResolver = this.config.ROOT_RESOLVER;
    if (rootResolver) return this.ensureRootNamespace(domain, rootResolver);
    const factory = this.config.NAMESPACE_FACTORY;
    const { REGISTRY, PERMISSIONED_RESOLVER, REGISTRAR_ADDRESS } = this.config;
    if (!factory || !REGISTRY || !PERMISSIONED_RESOLVER || !REGISTRAR_ADDRESS)
      throw new Error(
        "a namespace needs NAMESPACE_FACTORY, REGISTRY, PERMISSIONED_RESOLVER and REGISTRAR_ADDRESS"
      );
    if (!isDnsName(domain)) throw new Error(`"${domain}" is not a DNS name`);
    const domainB = toBytes32(domain);
    const existing = await this.publicClient.readContract({
      address: factory,
      abi: factoryAbi,
      functionName: "instance",
      args: [domainB],
    });
    if (existing.registry !== zeroAddress) return { domain, created: false, parentName: existing.parentName };

    const root = (await this.instances()).find((i) => i.registry.toLowerCase() === REGISTRY.toLowerCase());
    if (!root) throw new Error("root registry is not a known instance");
    const group = groupingFor(platformOf(domain) ?? "email");
    const labels = domain.toLowerCase().split(".");
    const leaf = labels[labels.length - 1] as string;

    await this.ensureDomainOnMultipass(domainB, REGISTRAR_ADDRESS);
    const open = await this.walkLevels(REGISTRY, [group.open, ...labels.slice(0, -1)]);
    // The mount's own name includes its label: an account under `x.com` reads `<handle>.com.x.www.<root>`.
    const parentName = [...[...labels].reverse(), group.open, root.parentName].join(".");
    await this.write({
      address: factory,
      abi: factoryAbi,
      functionName: "create",
      args: [domainB, open, leaf, parentName, PERMISSIONED_RESOLVER, 1],
    });
    const instance = await this.publicClient.readContract({
      address: factory,
      abi: factoryAbi,
      functionName: "instance",
      args: [domainB],
    });
    await this.mount(open, leaf, instance.registry);

    // The private branch names a masked account after the person holding it, so it reads the root
    // domain for the label and this domain for the account.
    const masked = await this.walkLevels(REGISTRY, [group.masked, ...labels.slice(0, -1)]);
    const maskedName = [...[...labels].reverse(), group.masked, root.parentName].join(".");
    await this.write({
      address: factory,
      abi: factoryAbi,
      functionName: "createMirror",
      args: [domainB, toBytes32(root.domain), masked, leaf, maskedName, PERMISSIONED_RESOLVER],
    });
    const mirror = await this.publicClient.readContract({
      address: factory,
      abi: factoryAbi,
      functionName: "mirror",
      args: [domainB],
    });
    await this.mount(masked, leaf, mirror.registry);
    this.mountsChanged();
    return { domain, created: true, parentName };
  }

  /**
   * A mount under one root resolver is a Multipass domain and nothing else: the resolver derives the
   * name from the domain, so there is no registry to deploy and no parent to point at it.
   */
  private async ensureRootDomain(domain: string): Promise<{ domain: string; created: boolean }> {
    const { REGISTRAR_ADDRESS } = this.config;
    if (!REGISTRAR_ADDRESS)
      throw new Error("a mount needs REGISTRAR_ADDRESS to initialise its Multipass domain");
    const created = await this.ensureDomainOnMultipass(toBytes32(domain), REGISTRAR_ADDRESS);
    // A domain that was inactive was not a mount either: either write makes one appear.
    if (created) this.mountsChanged();
    return { domain, created };
  }

  /** The DNS half of the same thing, which also has to say where the mount is named. */
  private async ensureRootNamespace(
    domain: string,
    resolver: Address
  ): Promise<{ domain: string; created: boolean; parentName: string }> {
    if (!this.config.REGISTRAR_ADDRESS) throw new Error("a namespace needs REGISTRAR_ADDRESS");
    if (!isDnsName(domain)) throw new Error(`"${domain}" is not a DNS name`);
    const mount = this.mountUnderRoot(domain, await this.rootName(resolver));
    if (!mount) throw new Error(`"${domain}" is not a name this deployment mounts`);
    const { created } = await this.ensureRootDomain(domain);
    return { domain, created, parentName: mount.parentName };
  }

  /**
   * Initialise and activate a Multipass domain that has never been used. Answers whether anything was
   * written: a domain that was already there and active is a mount that already existed.
   */
  private async ensureDomainOnMultipass(domainB: Hex, registrar: Address): Promise<boolean> {
    const state = await this.publicClient.readContract({
      address: this.config.MULTIPASS,
      abi: MultipassAbi,
      functionName: "getDomainState",
      args: [domainB],
    });
    if (state.name === zeroHash) {
      await this.write({
        address: this.config.MULTIPASS,
        abi: MultipassAbi,
        functionName: "initializeDomain",
        args: [registrar, 0n, 0n, domainB, 0n, 0n],
      });
    }
    if (!state.isActive) {
      await this.write({
        address: this.config.MULTIPASS,
        abi: MultipassAbi,
        functionName: "activateDomain",
        args: [domainB],
      });
    }
    return state.name === zeroHash || !state.isActive;
  }

  /**
   * Walk down a chain of grouping levels from `parent`, deploying the ones that are missing. Returns the
   * registry the instance itself mounts under.
   */
  private async walkLevels(parent: Address, labels: string[]): Promise<Address> {
    let at = parent;
    for (const label of labels) {
      const found = await this.publicClient.readContract({
        address: at,
        abi: registryAbi,
        functionName: "getSubregistry",
        args: [label],
      });
      if (found !== zeroAddress) {
        at = found;
        continue;
      }
      const hash = await this.walletClient.deployContract({
        chain: this.walletClient.chain,
        account: this.walletClient.account!,
        abi: groupingRegistry.abi,
        bytecode: groupingRegistry.bytecode as Hex,
        args: [at, label, this.walletClient.account!.address],
      });
      const receipt = await this.wait(hash);
      const level = receipt.contractAddress;
      if (!level) throw new Error(`level "${label}": no contract address in receipt`);
      await this.mount(at, label, level);
      at = level;
    }
    return at;
  }

  private async mount(parent: Address, label: string, child: Address): Promise<void> {
    await this.write({
      address: parent,
      abi: registryAbi,
      functionName: "setSubregistry",
      args: [label, child],
    });
  }

  /** One owner transaction, waited for: provisioning is a sequence and a dropped step leaves a gap. */
  private async write(call: Record<string, unknown>): Promise<void> {
    await this.wait(
      await this.walletClient.writeContract({
        chain: this.walletClient.chain,
        account: this.walletClient.account!,
        ...call,
      } as Parameters<typeof this.walletClient.writeContract>[0])
    );
  }

  /**
   * The name a wallet has set as its primary in ENS's own reverse namespace, if any. This is the answer a
   * wallet or explorer shows beside an address, and it is not ours to write: the holder sets it. Empty
   * means nobody set one, which is why this deployment also answers reverse lookups from the record.
   */
  async primaryName(address: Address): Promise<string | null> {
    if (!this.config.UNIVERSAL_RESOLVER) return null;
    const [name] = await this.publicClient.readContract({
      address: this.config.UNIVERSAL_RESOLVER,
      abi: universalResolverAbi,
      functionName: "reverse",
      // 60 is the coin type for Ethereum, as ENSIP-9 numbers them.
      args: [address, 60n],
    });
    return name || null;
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
    /*
     * Advice, not a fault. `ok` drives a 503 and the banner the app shows over every page, so it is
     * reserved for a deployment that cannot do its job. A key layout worth improving is still worth
     * saying, and it is said in the same list a reader is already looking at.
     */
    const advisories: string[] = [];
    const [bridgeCode, multipassCode, factoryCode] = await Promise.all([
      this.publicClient.getCode({ address: this.config.BRIDGE }),
      this.publicClient.getCode({ address: this.config.MULTIPASS }),
      this.publicClient.getCode({ address: this.config.FACTORY }),
    ]);
    const deployed = (code: Hex | undefined) => !!code && code !== "0x";
    if (!deployed(bridgeCode)) warnings.push(`BRIDGE ${this.config.BRIDGE} has no code`);
    if (!deployed(multipassCode)) warnings.push(`MULTIPASS ${this.config.MULTIPASS} has no code`);
    if (!deployed(factoryCode)) warnings.push(`FACTORY ${this.config.FACTORY} has no code`);
    // Whether a signature this service makes will be accepted at all; see `eip712Warnings`.
    try {
      const domain = (await this.publicClient.readContract({
        address: this.config.MULTIPASS,
        abi: MultipassAbi,
        functionName: "eip712Domain",
      })) as [Hex, string, string, bigint, Address, Hex, bigint[]];
      warnings.push(...eip712Warnings(this.config, domain));
    } catch {
      // An older Multipass may not publish its domain; that is not a fault, only an unanswered question.
    }

    // Who can delete a record, which is the one power that contradicts what the product promises.
    try {
      const owner = (await this.publicClient.readContract({
        address: this.config.MULTIPASS,
        abi: [
          {
            type: "function",
            name: "owner",
            inputs: [],
            outputs: [{ type: "address" }],
            stateMutability: "view",
          },
        ] as const,
        functionName: "owner",
      })) as Address;
      advisories.push(...ownershipWarnings(this.relayer, owner));
    } catch {
      // A Multipass that does not publish an owner leaves the question unanswered, not failed.
    }

    // Without it, a domain nobody deployed cannot be mounted on demand and the person is turned away.
    // Pointed at nothing is worse than unset: every page that lists the mounts fails instead. Under a
    // root resolver there is nothing to deploy for one, so its absence is not a fault.
    const namespaceFactory = this.config.NAMESPACE_FACTORY;
    const namespaceCode = namespaceFactory
      ? await this.publicClient.getCode({ address: namespaceFactory })
      : undefined;
    if (!namespaceFactory) {
      if (!this.config.ROOT_RESOLVER)
        warnings.push("NAMESPACE_FACTORY is unset: a domain nobody deployed yet cannot be mounted");
    } else if (!deployed(namespaceCode)) warnings.push(`NAMESPACE_FACTORY ${namespaceFactory} has no code`);

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
    // uninitialised one, and the user only finds out after signing. Every mount this deployment has is
    // a domain someone can be asked to sign for, so all of them are checked, not a fixed list.
    const mounted = (await this.instances().catch(() => []))
      .map((i) => i.domain)
      .filter((d) => !d.startsWith(this.config.VOUCH_PREFIX));
    const wanted = [...new Set([...this.config.NAME_DOMAINS, ...PLATFORM_DOMAIN_NAMES, ...mounted])];
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
    // One root cause, one warning: a wrong key mismatches every domain, and nine copies of that line
    // buries whatever else is wrong.
    const onchainRegistrars = [...new Set(domains.filter((d) => d.initialised).map((d) => d.registrar))];
    if (configuredRegistrar) {
      const wrong = domains.filter(
        (d) => d.initialised && d.registrar.toLowerCase() !== configuredRegistrar.toLowerCase()
      );
      if (wrong.length > 0) {
        const expected = [...new Set(wrong.map((d) => d.registrar))];
        warnings.push(
          `this service signs as ${configuredRegistrar}, but ${wrong.length} domain${wrong.length === 1 ? "" : "s"} ` +
            `(${wrong.map((d) => d.domain).join(", ")}) expect ${expected.join(", ")}`
        );
      }
    }

    // A start block far behind the head means a backfill measured in millions of blocks, which looks
    // like a broken service for as long as it runs. On a fresh chain the gap is small and this is fine.
    const behind = Number(BigInt(this.indexer.status().head) - BigInt(this.config.DEPLOY_BLOCK));
    if (behind > 1_000_000) {
      warnings.push(
        `DEPLOY_BLOCK is ${this.config.DEPLOY_BLOCK}, ${behind} blocks behind the head: set it to the block the deployment starts at`
      );
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
      // Faults first: they are why somebody opened this, and the advice reads after them.
      bridge: { address: this.config.BRIDGE, deployed: deployed(bridgeCode), missing },
      multipass: { address: this.config.MULTIPASS, deployed: deployed(multipassCode), domains },
      factory: { address: this.config.FACTORY, deployed: deployed(factoryCode), instances },
      namespaceFactory: namespaceFactory
        ? { address: namespaceFactory, deployed: deployed(namespaceCode) }
        : null,
      registrar: { signsAs: configuredRegistrar ?? null, onchain: onchainRegistrars },
      relayer: { address: this.relayer, balance: relayerBalance.toString() },
      warnings: [...warnings, ...advisories],
    };
  }

  private headOrZero(): bigint {
    return BigInt(this.indexer.status().head);
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

  /**
   * One wallet's record in one domain, read straight from Multipass. The index is how a wallet's whole
   * history is listed, but a candidate's own name must never depend on a backfill having finished:
   * this answers from the chain in a single call.
   */
  async recordFor(wallet: Address, domain: string): Promise<(ListedRecord & { domain: string }) | undefined> {
    const [ok, r] = await this.publicClient.readContract({
      address: this.config.MULTIPASS,
      abi: MultipassAbi,
      functionName: "resolveRecord",
      args: [
        {
          name: zeroHash,
          id: zeroHash,
          wallet,
          domainName: toBytes32(domain),
          targetDomain: zeroHash,
        },
      ],
    });
    if (!ok) return undefined;
    return {
      domain,
      name: fromBytes32(r.name),
      id: r.id,
      wallet: r.wallet,
      payload: r.payload,
      validUntil: r.validUntil,
      nonce: r.nonce,
      live: r.validUntil > BigInt(Math.floor(Date.now() / 1000)),
    };
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
    return receipt;
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

  /**
   * Reverse resolution, straight from Multipass: the resolver takes `<40 hex>.addr.reverse`, reads the
   * record that wallet holds in its domain, and answers with that name. No reverse registry is involved,
   * which is why it works today — a third-party client reaches it only once ENS's reverse namespace
   * points here.
   */
  async reverseName(resolver: Address, wallet: Address): Promise<string> {
    const reverse = `${wallet.slice(2).toLowerCase()}.addr.reverse`;
    const out = await this.publicClient.readContract({
      address: resolver,
      abi: resolverAbi,
      functionName: "resolve",
      args: [
        dnsEncode(reverse),
        encodeFunctionData({ abi: resolverAbi, functionName: "name", args: [namehash(reverse)] }),
      ],
    });
    return decodeAbiParameters([{ type: "string" }], out)[0];
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
  | "deleteRecord"
  | "instances"
  | "submit"
  | "resolveText"
  | "resolveUniversal"
  | "reverseName"
  | "resolveAddr"
  | "resolveData"
  | "relayer"
  | "ensureVouchInstance"
  | "listRecords"
  | "nameStatus"
  | "listRecordsByWallet"
  | "recordFor"
  | "balance"
  | "sendEth"
  | "indexStatus"
  | "preflight"
  | "domainReady"
  | "ethLabelOwner"
  | "primaryName"
  | "ensureNamespace"
>;

function toListed(r: IndexedRecord): ListedRecord & { domain: string } {
  return {
    domain: r.domain,
    name: r.name,
    rawName: r.rawName,
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
  /** The later factory carrying the DNS namespace, when this deployment has one */
  namespaceFactory: { address: Address; deployed: boolean } | null;
  registrar: { signsAs: Address | null; onchain: Address[] };
  relayer: { address: Address; balance: string };
  warnings: string[];
};
