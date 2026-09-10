import {
  concatHex,
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  keccak256,
  namehash,
  parseAbi,
  toHex,
  zeroAddress,
  zeroHash,
  type Abi,
  type Address,
  type Chain,
  type Hex,
} from "viem";
import { foundry, sepolia } from "viem/chains";
import errors from "@ketsuban/contracts/errors" with { type: "json" };
import { toBytes32 } from "@peeramid-labs/multipass-client";

/** ENS profile keys the bridge grants `ROLE_SET_TEXT` on when a name lands (AttestationBridge._grantProfileKeys). */
export const PROFILE_KEYS = ["avatar", "description", "url", "email"] as const;
export type ProfileKey = (typeof PROFILE_KEYS)[number];

/**
 * Every custom error in the deployment, generated from the compiled contracts. viem decodes a revert
 * only when it is in the ABI it was given, and the error that fires usually belongs to a contract
 * further down the call, so a bare `0xd1cc1202` is what a user sees otherwise. Merged into both write
 * ABIs below.
 */
export const errorsAbi = errors as Abi;

export const resolverWriteAbi = [
  ...parseAbi(["function setText(bytes32 node, string key, string value)"]),
  ...errorsAbi,
];
export const bridgeWriteAbi = [
  ...parseAbi(["function linkOwnName(bytes32 domain, string label)"]),
  ...errorsAbi,
];

/**
 * The ENSv2 `.eth` registrar, and the token it prices names in. Registering is two transactions with a
 * wait between them, and it has to come from the wallet that will hold the name: the registrar mints
 * only to its caller, and the names it mints do not transfer.
 */
export const registrarWriteAbi = [
  ...parseAbi([
    "function commit(bytes32 commitment)",
    "function commitmentAt(bytes32 commitment) view returns (uint64)",
    "function isAvailable(string label) view returns (bool)",
    "function getRegisterPrice(string label, uint64 duration, address paymentToken) view returns (uint256 base, uint256 premium)",
    "function makeCommitment(string label, address owner, bytes32 secret, address subregistry, address resolver, uint64 duration, bytes32 referrer) pure returns (bytes32)",
    "function register(string label, address owner, bytes32 secret, address subregistry, address resolver, uint64 duration, address paymentToken, bytes32 referrer) returns (uint256)",
  ]),
  ...errorsAbi,
];

export const tokenWriteAbi = [
  ...parseAbi([
    "function balanceOf(address) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)",
    "function mint(address to, uint256 amount)",
  ]),
  ...errorsAbi,
];

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

/**
 * Put the wallet on the chain this deployment lives on, or say so plainly.
 *
 * A wallet sitting on mainnet signs nothing useful here, and viem's own refusal names two chain ids and
 * a calldata blob. Asking the wallet to switch is one request; a wallet that will not switch is a
 * sentence, not a stack trace.
 */
export async function onTargetChain(signer: Signer): Promise<void> {
  const current = Number(
    (await signer.provider.request({ method: "eth_chainId" }).catch(() => undefined)) ?? signer.chainId
  );
  if (current === signer.chainId) return;
  const target = chainFor(signer.chainId);
  try {
    await signer.provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: `0x${signer.chainId.toString(16)}` }],
    });
  } catch {
    throw new Error(
      `Your wallet is on chain ${current}; this deployment is on ${target.name} (${signer.chainId}). Switch the network in your wallet and try again.`
    );
  }
}

async function send(
  signer: Signer,
  tx: {
    address: Address;
    abi: Abi;
    functionName: string;
    args: unknown[];
  }
): Promise<Hex> {
  await onTargetChain(signer);
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

/** The longest letter worth writing as one text record: beyond this a single transaction gets expensive. */
export const LETTER_MAX = 600;

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

export type EthNameParams = {
  registrar: Address;
  token: Address;
  resolver: Address;
  label: string;
  owner: Address;
  /** How long the name is registered for, in seconds */
  duration: bigint;
};

/** The secret is derived from the owner and the label, so both steps agree without storing anything. */
function nameSecret(label: string, owner: Address): Hex {
  return keccak256(concatHex([toHex(`ketsuban:${label}`), owner]));
}

function nameArgs(p: EthNameParams) {
  return [p.label, p.owner, nameSecret(p.label, p.owner), zeroAddress, p.resolver, p.duration] as const;
}

/**
 * Step one: pay for the name and record the intent to register it. The registrar reverts with no reason
 * at all when both the subregistry and the resolver are zero, so a resolver is always passed.
 *
 * Returns when the commitment can be used, which the registrar makes the caller wait for.
 */
export async function commitEthName(signer: Signer, p: EthNameParams): Promise<{ readyAt: number }> {
  await onTargetChain(signer);
  const chain = chainFor(signer.chainId);
  const transport = custom(signer.provider as Parameters<typeof custom>[0]);
  const pub = createPublicClient({ chain, transport });
  const [base, premium] = await pub.readContract({
    address: p.registrar,
    abi: registrarWriteAbi,
    functionName: "getRegisterPrice",
    args: [p.label, p.duration, p.token],
  });
  const price = base + premium;
  const balance = await pub.readContract({
    address: p.token,
    abi: tokenWriteAbi,
    functionName: "balanceOf",
    args: [p.owner],
  });
  // The payment token mints freely on a test chain, which is the only chain this flow is for.
  if (balance < price) {
    await send(signer, {
      address: p.token,
      abi: tokenWriteAbi,
      functionName: "mint",
      args: [p.owner, price - balance],
    });
  }
  await send(signer, {
    address: p.token,
    abi: tokenWriteAbi,
    functionName: "approve",
    args: [p.registrar, price],
  });
  const commitment = await pub.readContract({
    address: p.registrar,
    abi: registrarWriteAbi,
    functionName: "makeCommitment",
    args: [...nameArgs(p), zeroHash],
  });
  const existing = await pub.readContract({
    address: p.registrar,
    abi: registrarWriteAbi,
    functionName: "commitmentAt",
    args: [commitment],
  });
  if (existing === 0n) {
    await send(signer, {
      address: p.registrar,
      abi: registrarWriteAbi,
      functionName: "commit",
      args: [commitment],
    });
  }
  const at = await pub.readContract({
    address: p.registrar,
    abi: registrarWriteAbi,
    functionName: "commitmentAt",
    args: [commitment],
  });
  // Slack for block timestamps lagging wall clock: one second early is a revert.
  return { readyAt: Number(at) + 75 };
}

/** Step two, once the commitment has aged: the name is registered to the wallet that signs this. */
export function registerEthName(signer: Signer, p: EthNameParams): Promise<Hex> {
  return send(signer, {
    address: p.registrar,
    abi: registrarWriteAbi,
    functionName: "register",
    args: [...nameArgs(p), p.token, zeroHash],
  });
}
