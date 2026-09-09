import { zeroHash, type Address, type Hex } from "viem";
import { INTENT_TYPES, intentDomain, type Intent } from "@ketsuban/registrar";
import { toBytes32 } from "@peeramid-labs/multipass-client";

export const HANDLE_RE = /^[a-z0-9-]{1,31}$/;

export type IntentInput = {
  wallet: Address;
  domain: string;
  /** From GET /v1/nonce `next` */
  nonce: bigint;
  /** Unix seconds */
  now: number;
  optIn: boolean;
  pubkey: Hex;
  /** Name domains only */
  handle?: string;
  /** Name domains only, <= 31 bytes */
  answer?: string;
  isNameDomain: boolean;
  ttlSeconds?: number;
};

/** Build the EIP-712 intent the embedded wallet signs (mirrors the registrar's validation) */
export function buildIntent(i: IntentInput): Intent {
  if (i.isNameDomain) {
    if (!HANDLE_RE.test(i.handle ?? "")) throw new Error("handle must be 1–31 chars of [a-z0-9-]");
    if (i.optIn) throw new Error("name-domain handles are public; opt-in applies to linked accounts");
  }
  return {
    wallet: i.wallet,
    domain: i.domain,
    nonce: i.nonce,
    exp: BigInt(i.now + (i.ttlSeconds ?? 600)),
    optIn: i.optIn,
    pubkey: i.pubkey,
    handle: i.isNameDomain ? (i.handle as string) : "",
    payload: i.isNameDomain && i.answer ? toBytes32(i.answer) : zeroHash,
  };
}

/**
 * Typed-data request for `signTypedData`. Two things matter here: `types` is copied because wallet
 * SDKs type it as mutable, and the numbers are decimal strings because the wallet serialises the
 * message as JSON, which cannot carry a BigInt. EIP-712 encodes both forms identically.
 */
export function intentTypedData(intent: Intent, chainId: number, multipass: Address) {
  const d = intentDomain(chainId, multipass);
  return {
    domain: { name: d.name as string, version: d.version as string, chainId, verifyingContract: multipass },
    types: { Intent: INTENT_TYPES.Intent.map((f) => ({ ...f })) },
    primaryType: "Intent" as const,
    message: { ...intent, nonce: intent.nonce.toString(), exp: intent.exp.toString() },
  };
}

/** JSON wire form (bigints as decimal strings) */
export function toWire(intent: Intent, idToken: string, signature: Hex) {
  return {
    idToken,
    signature,
    intent: { ...intent, nonce: intent.nonce.toString(), exp: intent.exp.toString() },
  };
}
