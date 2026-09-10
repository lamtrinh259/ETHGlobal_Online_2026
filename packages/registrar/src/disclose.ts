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
    { name: "domains", type: "string[]" },
    { name: "audience", type: "address" },
    { name: "audienceName", type: "string" },
    { name: "exp", type: "uint256" },
    { name: "boxesHash", type: "bytes32" },
  ],
} as const;

export type Disclosure = {
  /** The ENS name the disclosure is about, e.g. `alice.ketsuban.eth` */
  name: string;
  /** Platform domains being disclosed, in the order their boxes are carried, e.g. `["discord.com", "x"]` */
  domains: string[];
  /** Wallet allowed to read it, or the zero address when a name or nobody in particular is named */
  audience: Address;
  /**
   * Who may read it, said as a name rather than a wallet: `bob.ketsuban.eth` for one person, or
   * `*.com.acme.www.ketsuban.eth` for whoever holds a name in that branch. Empty when unused.
   */
  audienceName: string;
  /** Unix seconds */
  exp: bigint;
  /** keccak256 over every encrypted view code, so the signature binds to this exact set of boxes */
  boxesHash: Hex;
};

export type SignedDisclosure = Disclosure & { boxes: EciesBox[]; signature: Hex };

/**
 * The accounts of a grant in one order. Sharing three accounts is one decision and one signature, so
 * two identical selections must produce the same statement rather than two that differ by click order.
 */
export function domainsKey(domains: readonly string[]): string[] {
  return [...new Set(domains)].sort();
}

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

/** The hash one ciphertext contributes: the exact bytes, not just the fact of one. */
export function hashBox(box: EciesBox): Hex {
  return keccak256(concatHex([box.ephemeralPubkey, box.nonce, box.ciphertext]));
}

/**
 * What a grant's signature binds to. Order matters: two accounts whose boxes were swapped would hand a
 * reader one account's view code under the other's name, so the hash covers the sequence, not a set.
 */
export function hashBoxes(boxes: readonly EciesBox[]): Hex {
  return keccak256(concatHex(boxes.map(hashBox)));
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
  if (grant.boxes.length !== grant.domains.length) {
    throw new Error("disclosure: signature is for a different box set");
  }
  if (hashBoxes(grant.boxes) !== grant.boxesHash) {
    throw new Error("disclosure: signature is for a different box");
  }
}

/**
 * Does a name fall under a grant's audience. A pattern of `*.<branch>` means any name in that branch,
 * which is the case a wallet cannot express: "whoever at acme.com" is a group the holder cannot
 * enumerate, and ENSv2 answers for every name under the branch without any of them being registered.
 *
 * The `*.` requires at least one label, so the branch itself is not a name under it, and the match is
 * on whole labels, so `evil-acme` never passes as `acme`.
 */
export function matchesAudienceName(pattern: string, name: string | undefined): boolean {
  if (!name) return false;
  const want = pattern.toLowerCase();
  const got = name.toLowerCase();
  if (!want.startsWith("*.")) return want === got;
  const branch = want.slice(2);
  return got.endsWith(`.${branch}`) && got.length > branch.length + 1;
}

/**
 * May this reader open it. Separate from `checkDisclosure` because the audience is unknown when a grant
 * is stored and decisive when it is read: a grant addressed to one wallet must not open for an
 * anonymous caller.
 *
 * `readerName` is a name the caller has already proved the reader holds — resolved on chain, not
 * claimed — so a grant may be addressed to a person or a branch rather than to a key.
 */
export function checkAudience(
  grant: SignedDisclosure,
  who: { reader?: Address; readerName?: string } = {}
): void {
  const anyone = "0x0000000000000000000000000000000000000000";
  if (grant.audienceName) {
    if (!matchesAudienceName(grant.audienceName, who.readerName)) {
      throw new Error("disclosure: addressed to a different reader");
    }
    return;
  }
  if (grant.audience.toLowerCase() === anyone) return;
  if (who.reader?.toLowerCase() !== grant.audience.toLowerCase()) {
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
    { name: "grantId", type: "bytes32" },
    { name: "at", type: "uint256" },
  ],
} as const;

export type Revocation = {
  name: string;
  /** Which grant is being taken back — one signature made it, one takes it back */
  grantId: Hex;
  /** Unix seconds the holder signed at */
  at: bigint;
};

/**
 * A grant's identity. Every box carries a fresh ephemeral key, so the hash over them is unique to this
 * grant, and it is already part of what the holder signed — which means a revocation naming it cannot
 * be pointed at some other grant.
 */
export function grantId(grant: Pick<Disclosure, "boxesHash">): Hex {
  return grant.boxesHash;
}

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
