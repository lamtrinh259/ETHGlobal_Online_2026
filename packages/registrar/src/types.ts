import type { Address, Hex } from "viem";
import type { RegisterMessage } from "@peeramid-labs/multipass-client";
import type { SignedInvite } from "./invite.js";

/**
 * Wallet-signed EIP-712 intent (spec B.2 / B.4). The user's embedded wallet
 * signs this in the browser; it is the only thing that binds `wallet` to the
 * registration request.
 *
 * `handle` and `payload` are used by name domains only (ENS label + answer);
 * platform domains must pass `handle = ""` and `payload = 0x00..00`.
 */
export type Intent = {
  wallet: Address;
  /** Multipass domain: a name domain from `AttestEnv.nameDomains`, or a platform domain ("x", "telegram", ...) */
  domain: string;
  /** Strictly greater than the on-chain nonce for this id; first registration >= 1 */
  nonce: bigint;
  /** Unix seconds; intent is rejected after this */
  exp: bigint;
  /** Opt in to XOR-masked name/id with a view-code commitment in payload (A.3) */
  optIn: boolean;
  /** Compressed or uncompressed secp256k1 public key the view code is encrypted to */
  pubkey: Hex;
  /** name domains only: the ENS label (<= 31 bytes, [a-z0-9-]) */
  handle: string;
  /** name domains only: this period's answer as bytes32 */
  payload: Hex;
};

/** Lightweight linked account as carried in the Privy identity token's `linked_accounts` claim */
export type LinkedAccount = {
  type: string;
  address?: string;
  chain_type?: string;
  subject?: string;
  username?: string;
  name?: string;
  email?: string;
  telegram_user_id?: string;
  telegramUserId?: string;
  first_name?: string;
};

/** Verified claims of a Privy identity token */
export type IdentityClaims = {
  sub: string;
  iss: string;
  aud: string;
  exp: number;
  iat?: number;
  linked_accounts: string;
};

/** EC P-256 public key in JWK form (Privy dashboard → verification key) */
export type Jwk = { kty: "EC"; crv: "P-256"; x: string; y: string };

/** Current on-chain state for (wallet, domain), read on the public leg */
export type OnchainState = {
  exists: boolean;
  nonce: bigint;
  id: Hex;
  wallet: Address;
  /**
   * Vouch domains only: the wallet holding the candidate's name in the root name domain. The invite
   * must be signed by it, so a statement can only be written into a vouch domain by someone the
   * candidate asked. Zero address when the candidate holds no live name.
   */
  candidateWallet?: Address;
  /**
   * Vouch domains only: the domains the writer holds live records in. An invitation may ask for a
   * workplace or a university address, and that is only checkable against what they have attested.
   */
  writerDomains?: string[];
  /**
   * Vouch domains only: whether the intent's wallet holds a live record in the organisation domain. An
   * organisation may write a reference for a handle nobody has claimed yet — the university case — so
   * it needs no invitation.
   */
  issuerOrg?: boolean;
};

/** Vault-held secrets; in the enclave these exist only for the duration of the call */
export type RegistrarSecrets = {
  /** secp256k1 private key of the domain registrar (Multipass `Domain.registrar`) */
  registrarKey: Hex;
  /** 32-byte HMAC key deriving view codes (A.3) */
  viewcodeKey: Hex;
};

export type AttestEnv = {
  /** Unix seconds; from `runtime.now()` in CRE, never `Date.now()` */
  now: number;
  chainId: number;
  /** Multipass proxy address */
  multipass: Address;
  /** Multipass EIP-712 domain, from `eip712Domain()` */
  eip712: { name: string; version: string };
  privy: { appId: string; verificationKey: Jwk };
  /**
   * Name domains: records are `{ name: handle, id: keccak256(DID), payload: answer }` and become
   * ENS labels under the instance's parent name. A deployment argument — e.g. `["kju-is"]`.
   */
  nameDomains: readonly string[];
  /**
   * Prefixes marking dynamically created name domains — per-candidate vouch instances are
   * `~<candidate>`; a record there is `{ name: voucher handle, id: keccak256(DID), payload: statement }`.
   * Default `["~"]`.
   */
  nameDomainPrefixes?: readonly string[];
  /** Platform domains accepted; default: every key of PLATFORM_DOMAINS */
  platformDomains?: readonly string[];
  /** Record term in seconds; default 30 days */
  termSeconds?: number;
  /**
   * Labels a person may not claim in a name domain; default `RESERVED_HANDLES`. Each platform has its
   * own instance under the root, so those labels are namespaces rather than free handles.
   */
  reservedHandles?: readonly string[];
  /**
   * Multipass domain whose holders are onboarded organisations; they may issue references uninvited.
   * Default "org".
   */
  orgDomain?: string;
  /**
   * Whether a record in a vouch domain needs the candidate's signed invitation. Default true:
   * without it anyone could write a statement into a stranger's vouch domain.
   */
  requireInvite?: boolean;
};

export type AttestRequest = {
  idToken: string;
  intent: Intent;
  signature: Hex;
  /** Required for vouch domains unless `AttestEnv.requireInvite` is false: the candidate's invitation */
  invite?: SignedInvite;
};

/** Deterministic ECIES box carrying the view code to the user (B.4 `eciesEncrypt`) */
export type EciesBox = {
  ephemeralPubkey: Hex;
  nonce: Hex;
  ciphertext: Hex;
};

export type AttestResult = {
  record: RegisterMessage;
  signature: Hex;
  viewCode?: EciesBox;
};

export type { RegisterMessage };
