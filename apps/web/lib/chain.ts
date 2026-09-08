import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  namehash,
  parseAbi,
  type Address,
  type Chain,
  type Hex,
} from "viem";
import { foundry, sepolia } from "viem/chains";
import { toBytes32 } from "@peeramid-labs/multipass-client";

/** ENS profile keys the bridge grants `ROLE_SET_TEXT` on when a name lands (AttestationBridge._grantProfileKeys). */
export const PROFILE_KEYS = ["avatar", "description", "url", "email"] as const;
export type ProfileKey = (typeof PROFILE_KEYS)[number];

export const resolverWriteAbi = parseAbi(["function setText(bytes32 node, string key, string value)"]);
export const bridgeWriteAbi = parseAbi(["function linkOwnName(bytes32 domain, string label)"]);

const KNOWN: Record<number, Chain> = { [sepolia.id]: sepolia, [foundry.id]: foundry };

/** viem chain for the configured id; unknown ids get a minimal definition (the wallet supplies the RPC). */
export function chainFor(id: number): Chain {
  return (
    KNOWN[id] ??
    defineChain({
      id,
      name: `chain-${id}`,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [] } },
    })
  );
}

/** The subset of EIP-1193 viem's `custom` transport needs; Privy's provider and browser wallets both satisfy it. */
export type Eip1193Request = { request(args: { method: string; params?: unknown }): Promise<unknown> };

export interface Signer {
  provider: Eip1193Request;
  account: Address;
  chainId: number;
}

async function send(
  signer: Signer,
  tx: {
    address: Address;
    abi: typeof resolverWriteAbi | typeof bridgeWriteAbi;
    functionName: string;
    args: unknown[];
  }
): Promise<Hex> {
  const chain = chainFor(signer.chainId);
  const transport = custom(signer.provider as Parameters<typeof custom>[0]);
  const wallet = createWalletClient({ account: signer.account, chain, transport });
  const hash = await wallet.writeContract({
    address: tx.address,
    abi: tx.abi,
    functionName: tx.functionName as never,
    args: tx.args as never,
  });
  const receipt = await createPublicClient({ chain, transport }).waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`transaction ${hash} reverted`);
  return hash;
}

/** Write one ENS text record on the PermissionedResolver for `name` (node = namehash). */
export function writeProfileText(
  signer: Signer,
  resolver: Address,
  name: string,
  key: ProfileKey,
  value: string
): Promise<Hex> {
  return send(signer, {
    address: resolver,
    abi: resolverWriteAbi,
    functionName: "setText",
    args: [namehash(name), key, value],
  });
}

/** `<parentLabel>.<label>.eth` → the caller's record in `domain`; the bridge checks `.eth` ownership on-chain. */
export function linkOwnName(signer: Signer, bridge: Address, domain: string, label: string): Promise<Hex> {
  return send(signer, {
    address: bridge,
    abi: bridgeWriteAbi,
    functionName: "linkOwnName",
    args: [toBytes32(domain), label],
  });
}
