import {
  createPublicClient,
  createWalletClient,
  decodeAbiParameters,
  encodeFunctionData,
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
import type { OnchainState, RegisterMessage } from "@att/registrar";
import { bridgeAbi, factoryAbi, resolverAbi } from "./abi.js";
import type { Config } from "./config.js";

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
    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
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
  "readOnchain" | "instances" | "submit" | "resolveText" | "resolveAddr" | "resolveData" | "relayer"
>;
