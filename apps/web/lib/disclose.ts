import { concatHex, keccak256, toHex, type Address, type Hex } from "viem";
import {
  DISCLOSE_TYPES,
  discloseDomain,
  domainsKey,
  eciesEncrypt,
  hashBoxes,
  linkKeyHash,
  REVOKE_TYPES,
  ZERO_ADDRESS,
} from "@ketsuban/registrar";

export const DISCLOSURE_DAYS = 30;

/**
 * Build a permission to read one masked account: the view code encrypted to the enclave's key, and the
 * fields the candidate signs over. The enclave can open it; nobody else can, including the service that
 * stores it and the verifier who reads the answer.
 */
export function buildDisclosure(input: {
  name: string;
  /** One entry per account being shared; the order is the grant's own and must not be re-sorted after */
  accounts: { domain: string; viewCode: Hex }[];
  enclavePubkey: Hex;
  audience?: Address;
  /** Who may read it, said as a name: `bob.<root>` for one person, `*.<branch>` for a whole branch */
  audienceName?: string;
  now: number;
  days?: number;
}) {
  const domains = domainsKey(input.accounts.map((a) => a.domain));
  // A fresh ephemeral key per box: two grants of the same view code must not be linkable by bytes.
  const boxes = domains.map((domain) => {
    const account = input.accounts.find((a) => a.domain === domain)!;
    const seed = crypto.getRandomValues(new Uint8Array(32));
    return eciesEncrypt(input.enclavePubkey, hexToBytes32(account.viewCode), seed);
  });
  const disclosure = {
    name: input.name,
    domains,
    audience: input.audience ?? (ZERO_ADDRESS as Address),
    audienceName: input.audienceName ?? "",
    exp: BigInt(input.now + (input.days ?? DISCLOSURE_DAYS) * 86_400),
    boxesHash: hashBoxes(boxes),
  };
  return { disclosure, boxes };
}

/** Typed data for `signTypedData`; numbers are strings because the wallet serialises the message. */
export function disclosureTypedData(
  disclosure: ReturnType<typeof buildDisclosure>["disclosure"],
  chainId: number,
  multipass: Address
) {
  const d = discloseDomain(chainId, multipass);
  return {
    domain: { name: d.name as string, version: d.version as string, chainId, verifyingContract: multipass },
    types: { Disclose: DISCLOSE_TYPES.Disclose.map((f) => ({ ...f })) },
    primaryType: "Disclose" as const,
    message: { ...disclosure, exp: disclosure.exp.toString() },
  };
}

/**
 * Typed data for taking a permission back. Dated, because the attester refuses a stale one: without
 * that, a revocation signed today could be replayed to undo a share made next month.
 */
export function revocationTypedData(
  revocation: { name: string; grantId: Hex; at: number },
  chainId: number,
  multipass: Address
) {
  const d = discloseDomain(chainId, multipass);
  return {
    domain: { name: d.name as string, version: d.version as string, chainId, verifyingContract: multipass },
    types: { Revoke: REVOKE_TYPES.Revoke.map((f) => ({ ...f })) },
    primaryType: "Revoke" as const,
    message: { ...revocation, at: revocation.at.toString() },
  };
}

/** JSON wire form the attester accepts. */
export function toDisclosureWire(
  disclosure: ReturnType<typeof buildDisclosure>["disclosure"],
  boxes: ReturnType<typeof buildDisclosure>["boxes"],
  signature: Hex,
  /** Hashed here: the attester stores what opens the link, never the thing that opens it */
  linkKey?: Hex
) {
  return {
    ...disclosure,
    exp: disclosure.exp.toString(),
    boxes,
    signature,
    ...(linkKey ? { linkKeyHash: linkKeyHash(linkKey) } : {}),
  };
}

/**
 * The secret that opens a grant made for whoever holds the link.
 *
 * A grant addressed to nobody binds nobody, so the link is the whole permission — and it named a
 * public name and a public account, both of which anybody can guess. An account shared that way was
 * not shared, it was published.
 */
export function newLinkKey(): Hex {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `0x${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}` as Hex;
}

/**
 * The key for a grant that rides along with an invitation.
 *
 * A candidate inviting somebody to refer them can open their private accounts to that writer, so the
 * writer is not asked to vouch for someone half-visible. That grant is addressed to nobody, because
 * the invitation is already the permission — so the secret that opens it is the invitation's own code,
 * which is in the link and nowhere else.
 */
export function linkKeyFromInvite(code: string): Hex {
  return keccak256(toHex(`ketsuban:invite:${code.toLowerCase()}`));
}

/** The link a candidate hands over: the verification card, with one account opened. */
export function revealLink(
  siteUrl: string,
  name: string,
  domains: string | string[],
  audience?: string,
  /** The secret, for a grant made for whoever holds the link rather than for one named reader */
  linkKey?: Hex
): string {
  // Carrying the audience is not a permission — the grant is what binds — but it lets the page say
  // which wallet has to be signed in, instead of showing a reader an empty answer.
  const to = audience ? `&for=${audience}` : "";
  const list = (Array.isArray(domains) ? domains : [domains]).join(",");
  // In the fragment: a browser never sends it to a server, so it stays out of logs and referrers.
  const secret = linkKey ? `#k=${linkKey}` : "";
  return `${siteUrl.replace(/\/$/, "")}/v/${name}?reveal=${encodeURIComponent(list)}${to}${secret}`;
}

function hexToBytes32(value: Hex): Uint8Array {
  const hex = value.slice(2).padStart(64, "0");
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Exported for the test: the grant must bind to its own ciphertext. */
export const boxHashOf = (box: { ephemeralPubkey: Hex; nonce: Hex; ciphertext: Hex }): Hex =>
  keccak256(concatHex([box.ephemeralPubkey, box.nonce, box.ciphertext]));
