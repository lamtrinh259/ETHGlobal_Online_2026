import { zeroHash, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { intentDomain, signIntent } from "../src/intent.js";
import { inviteDomain, signInvite, ZERO_ADDRESS, type Invite, type SignedInvite } from "../src/invite.js";
import { fakePrivy } from "../src/testing.js";
import type { AttestEnv, Intent, Jwk, LinkedAccount, RegistrarSecrets } from "../src/types.js";

export const NOW = 1_800_000_000; // fixed clock, unix seconds
export const APP_ID = "cltest-app-id";
export const CHAIN_ID = 11155111;
export const MULTIPASS: Address = "0x418F82fd0014a4CA402F145978bfaF0555a9cA06";

const privy = fakePrivy(APP_ID);
export const PRIVY_JWK: Jwk = privy.jwk;

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
    { type: "twitter_oauth", subject: "1234567890123456789", username: "alice", name: "Alice" },
    { type: "telegram", telegram_user_id: "987654321", username: "alice_tg", first_name: "Alice" },
    { type: "google_oauth", subject: "10987654321098765432", email: "alice@example.com" },
    { type: "email", address: "alice@example.com" },
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
  return privy.mint({
    sub: o.sub ?? DID,
    linked,
    now: NOW,
    alg: o.alg,
    iss: o.iss,
    aud: o.aud,
    exp: o.exp,
    omitLinkedAccounts: "linked_accounts" in o && o.linked_accounts === undefined,
    signWith: o.signWith,
  });
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

export async function signedRequest(
  intent: Intent,
  idToken = mintIdToken(),
  signer = userAccount,
  invite?: SignedInvite
) {
  const signature: Hex = await signIntent(signer, intent, intentDomain(CHAIN_ID, MULTIPASS));
  return { idToken, intent, signature, ...(invite ? { invite } : {}) };
}

/** The candidate's wallet in these fixtures: the same account, since one test user plays both parts. */
export const candidateAccount = userAccount;

/** An invitation from the candidate, open to anyone unless `voucher` is given. */
export async function makeInvite(
  over: Partial<Invite> = {},
  signer = candidateAccount
): Promise<SignedInvite> {
  const invite: Invite = {
    handle: "alice",
    voucher: ZERO_ADDRESS,
    exp: BigInt(NOW + 3600),
    requires: [],
    ...over,
  };
  const signature = await signInvite(signer, invite, inviteDomain(CHAIN_ID, MULTIPASS));
  return { ...invite, signature };
}

/** On-chain state for a vouch domain: no record yet, and the candidate holds their name. */
export const noVouchRecord = {
  exists: false,
  nonce: 0n,
  id: zeroHash,
  wallet: userAccount.address,
  candidateWallet: candidateAccount.address,
} as const;

export const noRecord = { exists: false, nonce: 0n, id: zeroHash, wallet: userAccount.address } as const;
