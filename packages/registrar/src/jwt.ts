import { p256 } from "@noble/curves/p256";
import { sha256 } from "@noble/hashes/sha256";
import { concatBytes } from "@noble/hashes/utils";
import { bytesToString, stringToBytes } from "viem";
import { base64urlDecode } from "./base64url";
import type { IdentityClaims, Jwk } from "./types";

export type VerifyJwtOptions = {
  issuer: string;
  audience: string;
  /** Unix seconds */
  now: number;
};

/** Uncompressed SEC1 point from a P-256 JWK */
export function jwkToPublicKey(jwk: Jwk): Uint8Array {
  if (jwk.kty !== "EC" || jwk.crv !== "P-256") throw new Error("jwt: verification key must be EC P-256");
  return concatBytes(Uint8Array.of(0x04), base64urlDecode(jwk.x), base64urlDecode(jwk.y));
}

/**
 * Verify an ES256 JWT offline (spec B.3: identity token signature, iss, aud, exp).
 * No I/O, no WebCrypto — runs inside the enclave.
 */
export function verifyEs256Jwt(token: string, jwk: Jwk, opts: VerifyJwtOptions): IdentityClaims {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("jwt: malformed token");
  const [h, p, s] = parts;

  const header = JSON.parse(bytesToString(base64urlDecode(h))) as { alg?: string };
  if (header.alg !== "ES256") throw new Error(`jwt: unsupported alg ${header.alg}`);

  const sig = base64urlDecode(s);
  if (sig.length !== 64) throw new Error("jwt: bad signature length");

  const msgHash = sha256(stringToBytes(`${h}.${p}`));
  if (!p256.verify(sig, msgHash, jwkToPublicKey(jwk), { lowS: false })) {
    throw new Error("jwt: invalid signature");
  }

  const claims = JSON.parse(bytesToString(base64urlDecode(p))) as Partial<IdentityClaims>;
  if (claims.iss !== opts.issuer) throw new Error(`jwt: issuer mismatch`);
  if (claims.aud !== opts.audience) throw new Error(`jwt: audience mismatch`);
  if (typeof claims.exp !== "number" || claims.exp <= opts.now) throw new Error("jwt: expired");
  if (typeof claims.sub !== "string" || claims.sub.length === 0) throw new Error("jwt: missing sub");
  if (typeof claims.linked_accounts !== "string") throw new Error("jwt: missing linked_accounts");

  return claims as IdentityClaims;
}
