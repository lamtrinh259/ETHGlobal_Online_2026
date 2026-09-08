import { p256 } from "@noble/curves/p256";
import { sha256 } from "@noble/hashes/sha256";
import { stringToBytes, zeroHash, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base64urlEncode } from "../src/base64url";
import { intentDomain, signIntent } from "../src/intent";
import type { AttestEnv, Intent, Jwk, LinkedAccount, RegistrarSecrets } from "../src/types";

export const NOW = 1_800_000_000; // fixed clock, unix seconds
export const APP_ID = "cltest-app-id";
export const CHAIN_ID = 11155111;
export const MULTIPASS: Address = "0x418F82fd0014a4CA402F145978bfaF0555a9cA06";

/** Test-only Privy signing key (P-256) */
const privyPriv = sha256(stringToBytes("privy-test-key"));
const privyPub = p256.getPublicKey(privyPriv, false);
export const PRIVY_JWK: Jwk = {
  kty: "EC",
  crv: "P-256",
  x: base64urlEncode(privyPub.slice(1, 33)),
  y: base64urlEncode(privyPub.slice(33, 65)),
};

export const USER_KEY = "0x000000000000000000000000000000000000000000000000000000000000a11c" as const;
export const userAccount = privateKeyToAccount(USER_KEY);
export const registrarAccount = privateKeyToAccount(
  "0x000000000000000000000000000000000000000000000000000000000000b0b0"
);

export const secrets: RegistrarSecrets = {
  registrarKey: "0x000000000000000000000000000000000000000000000000000000000000b0b0",
  viewcodeKey: "0x1111111111111111111111111111111111111111111111111111111111111111",
};

export const env: AttestEnv = {
  now: NOW,
  chainId: CHAIN_ID,
  multipass: MULTIPASS,
  eip712: { name: "MultipassDNS", version: "1.0.0" },
  privy: { appId: APP_ID, verificationKey: PRIVY_JWK },
  nameDomains: ["kju-is"],
};

export const DID = "did:privy:cm0000000000000000000000";

export function defaultLinked(): LinkedAccount[] {
  return [
    { type: "wallet", address: userAccount.address, chain_type: "ethereum" },
    { type: "twitter_oauth", subject: "1234567890123456789", username: "fatpig", name: "Fat Pig" },
    { type: "telegram", telegram_user_id: "987654321", username: "fatpig_tg", first_name: "Fat" },
    { type: "google_oauth", subject: "10987654321098765432", email: "fatpig@example.com" },
    { type: "email", address: "fatpig@example.com" },
  ];
}

export type TokenOverrides = Partial<{
  alg: string;
  iss: string;
  aud: string;
  exp: number;
  sub: string;
  linked_accounts: string | undefined;
  signWith: Uint8Array;
}>;

/** Mint an ES256 identity token shaped like Privy's */
export function mintIdToken(linked: LinkedAccount[] = defaultLinked(), o: TokenOverrides = {}): string {
  const header = { alg: o.alg ?? "ES256", typ: "JWT" };
  const payload: Record<string, unknown> = {
    sub: o.sub ?? DID,
    iss: o.iss ?? "privy.io",
    aud: o.aud ?? APP_ID,
    iat: NOW - 60,
    exp: o.exp ?? NOW + 3600,
    linked_accounts: "linked_accounts" in o ? o.linked_accounts : JSON.stringify(linked),
  };
  const h = base64urlEncode(stringToBytes(JSON.stringify(header)));
  const p = base64urlEncode(stringToBytes(JSON.stringify(payload)));
  const sig = p256.sign(sha256(stringToBytes(`${h}.${p}`)), o.signWith ?? privyPriv).toCompactRawBytes();
  return `${h}.${p}.${base64urlEncode(sig)}`;
}

export function makeIntent(over: Partial<Intent> = {}): Intent {
  return {
    wallet: userAccount.address,
    domain: "x",
    nonce: 1n,
    exp: BigInt(NOW + 600),
    optIn: false,
    pubkey: userAccount.publicKey,
    handle: "",
    payload: zeroHash,
    ...over,
  };
}

export async function signedRequest(intent: Intent, idToken = mintIdToken(), signer = userAccount) {
  const signature: Hex = await signIntent(signer, intent, intentDomain(CHAIN_ID, MULTIPASS));
  return { idToken, intent, signature };
}

export const noRecord = { exists: false, nonce: 0n, id: zeroHash, wallet: userAccount.address } as const;
