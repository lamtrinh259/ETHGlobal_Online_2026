import { p256 } from "@noble/curves/p256";
import { sha256 } from "@noble/hashes/sha256";
import { stringToBytes, zeroHash, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { base64urlEncode } from "./base64url.js";
import { intentDomain, signIntent } from "./intent.js";
import type { AttestRequest, Intent, Jwk, LinkedAccount } from "./types.js";

/**
 * Test-only helpers shared by the registrar, CRE and API test suites: a fake Privy issuer
 * (P-256 key + JWK), identity-token minting, and intent signing. Never bundled into production.
 */
export type FakePrivy = {
  appId: string;
  jwk: Jwk;
  /** Mint an ES256 identity token shaped like Privy's */
  mint(opts: MintOptions): string;
};

export type MintOptions = {
  sub: string;
  linked: LinkedAccount[];
  /** Unix seconds */
  now: number;
  ttlSeconds?: number;
  /** Overrides for negative tests */
  alg?: string;
  iss?: string;
  aud?: string;
  exp?: number;
  omitLinkedAccounts?: boolean;
  signWith?: Uint8Array;
};

export function fakePrivy(appId: string, seed = "privy-test-key"): FakePrivy {
  const priv = sha256(stringToBytes(seed));
  const pub = p256.getPublicKey(priv, false);
  const jwk: Jwk = {
    kty: "EC",
    crv: "P-256",
    x: base64urlEncode(pub.slice(1, 33)),
    y: base64urlEncode(pub.slice(33, 65)),
  };
  return {
    appId,
    jwk,
    mint(o) {
      const header = { alg: o.alg ?? "ES256", typ: "JWT" };
      const payload: Record<string, unknown> = {
        sub: o.sub,
        iss: o.iss ?? "privy.io",
        aud: o.aud ?? appId,
        iat: o.now - 60,
        exp: o.exp ?? o.now + (o.ttlSeconds ?? 3600),
      };
      if (!o.omitLinkedAccounts) payload.linked_accounts = JSON.stringify(o.linked);
      const h = base64urlEncode(stringToBytes(JSON.stringify(header)));
      const p = base64urlEncode(stringToBytes(JSON.stringify(payload)));
      const sig = p256.sign(sha256(stringToBytes(`${h}.${p}`)), o.signWith ?? priv).toCompactRawBytes();
      return `${h}.${p}.${base64urlEncode(sig)}`;
    },
  };
}

/** A user with an embedded wallet and the usual linked accounts */
export function fakeUser(privateKey: Hex, handle = "alice") {
  const account = privateKeyToAccount(privateKey);
  const did = `did:privy:${handle}`;
  const linked: LinkedAccount[] = [
    { type: "wallet", address: account.address, chain_type: "ethereum" },
    { type: "twitter_oauth", subject: "1234567890123456789", username: handle, name: "Alice" },
    { type: "telegram", telegram_user_id: "987654321", username: `${handle}_tg`, first_name: "Alice" },
    { type: "google_oauth", subject: "10987654321098765432", email: `${handle}@example.com` },
    { type: "email", address: `${handle}@example.com` },
  ];
  return { account, privateKey, did, linked };
}

export function baseIntent(account: PrivateKeyAccount, now: number, over: Partial<Intent> = {}): Intent {
  return {
    wallet: account.address,
    domain: "x",
    nonce: 1n,
    exp: BigInt(now + 600),
    optIn: false,
    pubkey: account.publicKey,
    handle: "",
    payload: zeroHash,
    ...over,
  };
}

export async function signedAttestRequest(
  account: PrivateKeyAccount,
  intent: Intent,
  idToken: string,
  chainId: number,
  multipass: Hex
): Promise<AttestRequest> {
  const signature = await signIntent(account, intent, intentDomain(chainId, multipass as `0x${string}`));
  return { idToken, intent, signature };
}

/** JSON wire form of an AttestRequest (bigints as decimal strings) */
export function toWire(req: AttestRequest) {
  return {
    idToken: req.idToken,
    signature: req.signature,
    intent: { ...req.intent, nonce: req.intent.nonce.toString(), exp: req.intent.exp.toString() },
  };
}
