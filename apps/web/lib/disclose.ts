import { keccak256, concatHex, type Address, type Hex } from "viem";
import {
  DISCLOSE_TYPES,
  discloseDomain,
  domainsKey,
  eciesEncrypt,
  hashBoxes,
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
  revocation: { name: string; domain: string; at: number },
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
  signature: Hex
) {
  return { ...disclosure, exp: disclosure.exp.toString(), boxes, signature };
}

/** The link a candidate hands over: the verification card, with one account opened. */
export function revealLink(
  siteUrl: string,
  name: string,
  domains: string | string[],
  audience?: string
): string {
  // Carrying the audience is not a permission — the grant is what binds — but it lets the page say
  // which wallet has to be signed in, instead of showing a reader an empty answer.
  const to = audience ? `&for=${audience}` : "";
  const list = (Array.isArray(domains) ? domains : [domains]).join(",");
  return `${siteUrl.replace(/\/$/, "")}/v/${name}?reveal=${encodeURIComponent(list)}${to}`;
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
