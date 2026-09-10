import {
  concatHex,
  keccak256,
  recoverTypedDataAddress,
  type Address,
  type Hex,
  type TypedDataDomain,
} from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import type { EciesBox } from "./types.js";

/**
 * A candidate's permission to read one masked account. The handle never becomes public: the view code
 * travels encrypted to the registrar's key, which lives in the enclave, so the enclave can answer "this
 * is @alice" to whoever the candidate allowed and nobody else.
 *
 * `audience` is the zero address for "anyone who asks", or a wallet for one verifier.
 */
export const DISCLOSE_TYPES = {
  Disclose: [
    { name: "name", type: "string" },
    { name: "domain", type: "string" },
    { name: "audience", type: "address" },
    { name: "exp", type: "uint256" },
    { name: "boxHash", type: "bytes32" },
  ],
} as const;

export type Disclosure = {
  /** The ENS name the disclosure is about, e.g. `alice.ketsuban.eth` */
  name: string;
  /** Platform domain being disclosed, e.g. `x` */
  domain: string;
  /** Wallet allowed to read it, or the zero address for anyone */
  audience: Address;
  /** Unix seconds */
  exp: bigint;
  /** keccak256 over the encrypted view code, so the signature binds to this exact box */
  boxHash: Hex;
};

export type SignedDisclosure = Disclosure & { box: EciesBox; signature: Hex };

/** Separated from every other domain so a disclosure can never be replayed as an intent or an invite */
export function discloseDomain(chainId: number, multipass: Address): TypedDataDomain {
  return { name: "Ketsuban Disclosure", version: "1", chainId, verifyingContract: multipass };
}

export async function recoverDiscloseSigner(
  disclosure: Disclosure,
  signature: Hex,
  domain: TypedDataDomain
): Promise<Address> {
  return recoverTypedDataAddress({
    domain,
    types: DISCLOSE_TYPES,
    primaryType: "Disclose",
    message: disclosure,
    signature,
  });
}

/** Client / test helper */
export async function signDisclosure(
  account: PrivateKeyAccount,
  disclosure: Disclosure,
  domain: TypedDataDomain
): Promise<Hex> {
  return account.signTypedData({
    domain,
    types: DISCLOSE_TYPES,
    primaryType: "Disclose",
    message: disclosure,
  });
}

/** The hash a disclosure signature binds to: the exact ciphertext, not just the fact of one. */
export function hashBox(box: EciesBox): Hex {
  return keccak256(concatHex([box.ephemeralPubkey, box.nonce, box.ciphertext]));
}

/**
 * Is this grant usable at all: signed by the wallet that holds the record, still valid, and bound to the
 * ciphertext it arrived with. Checked when a grant is accepted, and again before it is opened.
 */
export function checkDisclosure(
  grant: SignedDisclosure,
  opts: { holder: Address; now: number; signer: Address }
): void {
  if (grant.signature.length < 4) throw new Error("disclosure: missing signature");
  if (opts.signer.toLowerCase() !== opts.holder.toLowerCase()) {
    throw new Error("disclosure: not signed by the wallet that holds the record");
  }
  if (grant.exp <= BigInt(opts.now)) throw new Error("disclosure: expired");
  if (hashBox(grant.box) !== grant.boxHash) throw new Error("disclosure: signature is for a different box");
}

/**
 * May this reader open it. Separate from `checkDisclosure` because the audience is unknown when a grant
 * is stored and decisive when it is read: a grant addressed to one wallet must not open for an
 * anonymous caller.
 */
export function checkAudience(grant: SignedDisclosure, reader?: Address): void {
  const anyone = "0x0000000000000000000000000000000000000000";
  if (grant.audience.toLowerCase() === anyone) return;
  if (reader?.toLowerCase() !== grant.audience.toLowerCase()) {
    throw new Error("disclosure: addressed to a different reader");
  }
}

/**
 * Taking a grant back. A separate statement rather than a disclosure with a past expiry: the holder is
 * saying "stop answering for this account", and that has to be provable by the same wallet without
 * producing another ciphertext to store.
 */
export const REVOKE_TYPES = {
  Revoke: [
    { name: "name", type: "string" },
    { name: "domain", type: "string" },
    { name: "at", type: "uint256" },
  ],
} as const;

export type Revocation = {
  name: string;
  domain: string;
  /** Unix seconds the holder signed at */
  at: bigint;
};

/** How far from now a revocation may be dated and still count. */
export const REVOKE_WINDOW = 300;

export async function recoverRevokeSigner(
  revocation: Revocation,
  signature: Hex,
  domain: TypedDataDomain
): Promise<Address> {
  return recoverTypedDataAddress({
    domain,
    types: REVOKE_TYPES,
    primaryType: "Revoke",
    message: revocation,
    signature,
  });
}

/** Client / test helper */
export async function signRevocation(
  account: PrivateKeyAccount,
  revocation: Revocation,
  domain: TypedDataDomain
): Promise<Hex> {
  return account.signTypedData({
    domain,
    types: REVOKE_TYPES,
    primaryType: "Revoke",
    message: revocation,
  });
}

/**
 * Is this revocation usable: signed by the wallet that holds the record, and recent. Freshness is the
 * point — without it, a revocation captured today could silently undo a grant made next month.
 */
export function checkRevocation(
  revocation: Revocation,
  opts: { holder: Address; now: number; signer: Address }
): void {
  if (opts.signer.toLowerCase() !== opts.holder.toLowerCase()) {
    throw new Error("revocation: not signed by the wallet that holds the record");
  }
  const age = opts.now - Number(revocation.at);
  if (age >= REVOKE_WINDOW) throw new Error("revocation: too old");
  if (age <= -REVOKE_WINDOW) throw new Error("revocation: dated in the future");
}
