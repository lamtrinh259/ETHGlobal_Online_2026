import {
  bytesToString,
  recoverTypedDataAddress,
  stringToBytes,
  type Address,
  type Hex,
  type TypedDataDomain,
} from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import { base64urlDecode, base64urlEncode } from "./base64url.js";

/**
 * A candidate's invitation to be vouched for. Without it anyone could write a statement into a
 * stranger's vouch domain; with it, only people the candidate handed a link to can. Signed by the
 * wallet that holds `<handle>` in the root name domain, which the enclave reads on chain.
 *
 * `voucher` is the zero address for a link the candidate shares openly, or a specific wallet for a
 * one-person invitation.
 */
export const INVITE_TYPES = {
  Invite: [
    { name: "handle", type: "string" },
    { name: "voucher", type: "address" },
    { name: "exp", type: "uint256" },
    { name: "requires", type: "string[]" },
  ],
} as const;

export type Invite = {
  /** The candidate's handle in the root name domain */
  handle: string;
  /** Wallet allowed to use it, or the zero address for anyone holding the link */
  voucher: Address;
  /** Unix seconds */
  exp: bigint;
  /**
   * Accounts the candidate wants the writer to have attested — a workplace, a university address.
   * Part of what is signed, so relaxing it makes a different invitation rather than the same one.
   */
  requires: string[];
};

/**
 * Does this writer hold what the invitation asked for. Domains are compared whole and lowercased: a
 * suffix match would let `notmit.edu` pass for `mit.edu`, which is a different institution.
 */
export function meetsInvite(invite: Pick<Invite, "requires">, attested: readonly string[]): boolean {
  const held = new Set(attested.map((d) => d.toLowerCase()));
  return invite.requires.every((d) => held.has(d.toLowerCase()));
}

export type SignedInvite = Invite & { signature: Hex };

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

/** Separated from the intent domain so an invite can never be replayed as an intent */
export function inviteDomain(chainId: number, multipass: Address): TypedDataDomain {
  return { name: "Ketsuban Invite", version: "1", chainId, verifyingContract: multipass };
}

export async function recoverInviteSigner(
  invite: Invite,
  signature: Hex,
  domain: TypedDataDomain
): Promise<Address> {
  return recoverTypedDataAddress({
    domain,
    types: INVITE_TYPES,
    primaryType: "Invite",
    message: invite,
    signature,
  });
}

/** Client / test helper: sign an invite with a local account */
export async function signInvite(
  account: PrivateKeyAccount,
  invite: Invite,
  domain: TypedDataDomain
): Promise<Hex> {
  return account.signTypedData({ domain, types: INVITE_TYPES, primaryType: "Invite", message: invite });
}

/**
 * URL-safe transport: the candidate shares this in `/vouch/<handle>?invite=…`. Encoded with the
 * base64url helpers the JWT path already uses, so it works in the browser and in QuickJS alike.
 */
export function encodeInvite(invite: SignedInvite): string {
  const json = JSON.stringify({ ...invite, exp: invite.exp.toString() });
  return base64urlEncode(stringToBytes(json));
}

export function decodeInvite(token: string): SignedInvite {
  const json = bytesToString(base64urlDecode(token));
  const raw = JSON.parse(json) as {
    handle: string;
    voucher: Address;
    exp: string;
    requires?: string[];
    signature: Hex;
  };
  if (
    typeof raw.handle !== "string" ||
    typeof raw.voucher !== "string" ||
    typeof raw.signature !== "string"
  ) {
    throw new Error("invite: malformed");
  }
  return {
    handle: raw.handle,
    voucher: raw.voucher,
    exp: BigInt(raw.exp),
    // An invitation made before requirements existed asked for nothing, which is what it meant.
    requires: Array.isArray(raw.requires) ? raw.requires : [],
    signature: raw.signature,
  };
}

/** The candidate's handle a vouch domain belongs to: `~alice` → `alice`. */
export function candidateOf(domain: string, prefixes: readonly string[]): string | undefined {
  const p = prefixes.find((x) => domain.length > x.length && domain.startsWith(x));
  return p ? domain.slice(p.length) : undefined;
}

/** The statement a voucher writes to withdraw one: the record stays, its meaning does not. */
export const WITHDRAWN = "withdrawn";
