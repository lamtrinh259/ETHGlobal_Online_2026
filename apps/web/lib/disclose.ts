import { keccak256, concatHex, type Address, type Hex } from "viem";
import { DISCLOSE_TYPES, discloseDomain, eciesEncrypt, hashBox, ZERO_ADDRESS } from "@ketsuban/registrar";

export const DISCLOSURE_DAYS = 30;

/**
 * Build a permission to read one masked account: the view code encrypted to the enclave's key, and the
 * fields the candidate signs over. The enclave can open it; nobody else can, including the service that
 * stores it and the verifier who reads the answer.
 */
export function buildDisclosure(input: {
  name: string;
  domain: string;
  viewCode: Hex;
  enclavePubkey: Hex;
  audience?: Address;
  now: number;
  days?: number;
}) {
  // A fresh ephemeral key per grant: two grants of the same view code must not be linkable by bytes.
  const seed = crypto.getRandomValues(new Uint8Array(32));
  const box = eciesEncrypt(input.enclavePubkey, hexToBytes32(input.viewCode), seed);
  const disclosure = {
    name: input.name,
    domain: input.domain,
    audience: input.audience ?? (ZERO_ADDRESS as Address),
    exp: BigInt(input.now + (input.days ?? DISCLOSURE_DAYS) * 86_400),
    boxHash: hashBox(box),
  };
  return { disclosure, box };
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

/** JSON wire form the attester accepts. */
export function toDisclosureWire(
  disclosure: ReturnType<typeof buildDisclosure>["disclosure"],
  box: ReturnType<typeof buildDisclosure>["box"],
  signature: Hex
) {
  return { ...disclosure, exp: disclosure.exp.toString(), box, signature };
}

/** The link a candidate hands over: the verification card, with one account opened. */
export function revealLink(siteUrl: string, name: string, domain: string, audience?: string): string {
  // Carrying the audience is not a permission — the grant is what binds — but it lets the page say
  // which wallet has to be signed in, instead of showing a reader an empty answer.
  const to = audience ? `&for=${audience}` : "";
  return `${siteUrl.replace(/\/$/, "")}/v/${name}?reveal=${encodeURIComponent(domain)}${to}`;
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
