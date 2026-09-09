import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha256";
import { concatBytes } from "@noble/hashes/utils";
import { bytesToHex, hexToBytes, keccak256, stringToBytes, zeroHash, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  deriveViewCode,
  maskId,
  maskName,
  padId,
  registerNameTypes,
  toBytes32,
  viewCodeCommitment,
  type RegisterMessage,
} from "@peeramid-labs/multipass-client";
import {
  hasLinkedWallet,
  isDnsName,
  parseLinkedAccounts,
  pickAccountFor,
  pickPlatformAccount,
  PLATFORM_DOMAIN_NAMES,
  type PlatformAccount,
} from "./accounts.js";
import { eciesEncrypt } from "./ecies.js";
import { PRIVATE_GROUPINGS, PUBLIC_GROUPINGS } from "./namespace.js";
import { intentDomain, recoverIntentSigner } from "./intent.js";
import { candidateOf, inviteDomain, recoverInviteSigner, ZERO_ADDRESS } from "./invite.js";
import { verifyEs256Jwt } from "./jwt.js";
import type { AttestEnv, AttestRequest, AttestResult, OnchainState, RegistrarSecrets } from "./types.js";

const DAY = 24 * 60 * 60;
const HANDLE_RE = /^[a-z0-9-]{1,31}$/;

export const DEFAULT_NAME_DOMAIN_PREFIXES: readonly string[] = ["~"];

/**
 * Labels a person may not claim in a name domain, because something else already answers there. The
 * grouping levels are mounted at the root — `www` holds the platforms, the at-sign level holds the mail
 * domains, and each has a private mirror — so those four are the ones a person can never be called.
 *
 * The flat platform names are still here for a deployment that predates the DNS namespace, where `x`
 * is an instance under the root rather than a level under `www`.
 */
export const RESERVED_HANDLES: readonly string[] = [
  ...PLATFORM_DOMAIN_NAMES,
  ...PUBLIC_GROUPINGS,
  ...PRIVATE_GROUPINGS,
  "com",
  "org",
  "net",
  "eth",
  "me",
  "addr",
  "reverse",
];

/** A name domain is configured explicitly or carries a vouch-instance prefix (`~alice`). */
export function isNameDomain(
  domain: string,
  env: Pick<AttestEnv, "nameDomains" | "nameDomainPrefixes">
): boolean {
  if (env.nameDomains.includes(domain)) return true;
  const prefixes = env.nameDomainPrefixes ?? DEFAULT_NAME_DOMAIN_PREFIXES;
  return prefixes.some((p) => domain.length > p.length && domain.startsWith(p));
}

function isSupported(domain: string, env: AttestEnv): boolean {
  return isNameDomain(domain, env) || (env.platformDomains ?? PLATFORM_DOMAIN_NAMES).includes(domain);
}

/** Mask a platform id, hashing one too long to be stored verbatim so uniqueness survives. */
function maskedId(subject: string, viewCode: Hex): Hex {
  if (stringToBytes(subject).length <= 31) return maskId(subject, viewCode);
  const pad = hexToBytes(padId(viewCode));
  const id = hexToBytes(idToBytes32(subject));
  return bytesToHex(id.map((b, i) => b ^ (pad[i] as number)));
}

/**
 * What to store as the record's name: a Multipass name is a left-aligned bytes32, so 31 bytes is the
 * whole budget. The handle as the platform writes it comes first, then the label it takes in its
 * namespace, and a longer one is cut — a record that says something is better than a refusal, and for
 * a masked record none of it is readable anyway.
 */
function storable(username: string, label?: string): string {
  const fits = (v: string) => stringToBytes(v).length <= 31;
  if (fits(username)) return username;
  if (label && fits(label)) return label;
  // Shorten by characters rather than bytes: cutting UTF-8 mid-character would store a broken one, and
  // this runs where `TextDecoder` does not exist.
  let cut = username;
  while (cut.length > 0 && !fits(cut)) cut = cut.slice(0, -1);
  return cut;
}

/** Fit a platform id into bytes32: verbatim when it fits, keccak otherwise (never throws) */
export function idToBytes32(id: string): Hex {
  return stringToBytes(id).length <= 31 ? toBytes32(id) : keccak256(stringToBytes(id));
}

/**
 * Public leg (B.4 `attest`): no secrets, deterministic, runs on the DON.
 * Wallet signed this intent, it is fresh, the domain is known, the nonce
 * strictly increases, and a renewal may not rebind the wallet.
 */
export async function verifyPublicLeg(
  req: AttestRequest,
  onchain: OnchainState,
  env: AttestEnv
): Promise<void> {
  const { intent } = req;
  if (!isSupported(intent.domain, env)) throw new Error(`intent: unknown domain "${intent.domain}"`);

  const signer = await recoverIntentSigner(intent, req.signature, intentDomain(env.chainId, env.multipass));
  if (signer.toLowerCase() !== intent.wallet.toLowerCase()) throw new Error("intent: bad signature");
  if (intent.exp <= BigInt(env.now)) throw new Error("intent: expired");

  if (intent.nonce < 1n) throw new Error("intent: nonce must be >= 1");
  const onchainNonce = onchain.exists ? onchain.nonce : 0n;
  if (intent.nonce <= onchainNonce) throw new Error("intent: nonce not increasing");
  if (onchain.exists && onchain.wallet.toLowerCase() !== intent.wallet.toLowerCase()) {
    throw new Error("record: wallet mismatch");
  }

  await verifyInvite(req, onchain, env);
}

/**
 * A vouch domain belongs to its candidate: only someone they invited may write a statement there.
 * The invitation is signed by the wallet that holds the candidate's name, which the caller reads on
 * chain, so nothing here trusts the browser.
 */
export async function verifyInvite(req: AttestRequest, onchain: OnchainState, env: AttestEnv): Promise<void> {
  const prefixes = env.nameDomainPrefixes ?? DEFAULT_NAME_DOMAIN_PREFIXES;
  const candidate = candidateOf(req.intent.domain, prefixes);
  if (candidate === undefined) return;
  if (env.requireInvite === false) return;

  // The candidate invites a voucher once. Afterwards that voucher owns their own statement there and
  // can update or withdraw it without asking again — otherwise a withdrawal would need permission
  // from the person being vouched for.
  if (onchain.exists) return;

  // An onboarded organisation issues letters without being invited: a university writes to a graduate
  // who has never heard of this product, and the graduate claims the handle later. The organisation is
  // accountable because the letter carries its own name, and only the operator onboards one.
  if (onchain.issuerOrg) return;

  const invite = req.invite;
  if (!invite) throw new Error(`invite: ${req.intent.domain} needs the candidate's invitation`);
  if (invite.handle !== candidate) throw new Error("invite: for a different candidate");
  if (invite.exp <= BigInt(env.now)) throw new Error("invite: expired");
  if (
    invite.voucher.toLowerCase() !== ZERO_ADDRESS &&
    invite.voucher.toLowerCase() !== req.intent.wallet.toLowerCase()
  ) {
    throw new Error("invite: issued to a different wallet");
  }
  const candidateWallet = onchain.candidateWallet;
  if (!candidateWallet || candidateWallet.toLowerCase() === ZERO_ADDRESS) {
    throw new Error(`invite: ${candidate} holds no live name to invite from`);
  }
  const signer = await recoverInviteSigner(
    { handle: invite.handle, voucher: invite.voucher, exp: invite.exp },
    invite.signature,
    inviteDomain(env.chainId, env.multipass)
  );
  if (signer.toLowerCase() !== candidateWallet.toLowerCase()) {
    throw new Error("invite: not signed by the candidate");
  }
}

/**
 * Confidential leg (B.4 `confidentialLeg`): identity token, secrets, preimages.
 * Everything here is local computation; nothing leaves except the signed
 * record and, if opted in, the view code encrypted to the user.
 */
/**
 * Sign a record as the domain registrar. `attestConfidential` derives its record from a person's
 * identity token; an organisation has no such token — it is a wallet an operator onboarded — so the
 * fields are given directly and only the signing is shared.
 */
export async function signRecord(
  record: RegisterMessage,
  registrarKey: Hex,
  env: Pick<AttestEnv, "chainId" | "multipass" | "eip712">
): Promise<Hex> {
  return privateKeyToAccount(registrarKey).signTypedData({
    domain: { ...env.eip712, chainId: env.chainId, verifyingContract: env.multipass },
    types: registerNameTypes,
    primaryType: "registerName",
    message: record,
  });
}

export async function attestConfidential(
  req: AttestRequest,
  onchainId: Hex,
  secrets: RegistrarSecrets,
  env: AttestEnv
): Promise<AttestResult> {
  const { intent } = req;
  const claims = verifyEs256Jwt(req.idToken, env.privy.verificationKey, {
    issuer: "privy.io",
    audience: env.privy.appId,
    now: env.now,
  });
  const linked = parseLinkedAccounts(claims.linked_accounts);
  if (!hasLinkedWallet(linked, intent.wallet)) throw new Error("identity: wallet not linked to DID");

  let name: Hex;
  let id: Hex;
  let payload: Hex;
  let viewCode: Hex | undefined;

  if (isNameDomain(intent.domain, env)) {
    if (intent.optIn) throw new Error("intent: name-domain handle is public, opt-in not allowed");
    if (!HANDLE_RE.test(intent.handle)) throw new Error("intent: invalid handle");
    const reserved = env.reservedHandles ?? RESERVED_HANDLES;
    // A vouch domain is the candidate's own namespace, so a voucher there may be called anything.
    if (candidateOf(intent.domain, env.nameDomainPrefixes ?? DEFAULT_NAME_DOMAIN_PREFIXES) === undefined) {
      if (reserved.includes(intent.handle))
        throw new Error(`intent: "${intent.handle}" is a reserved handle`);
    }
    name = toBytes32(intent.handle);
    id = keccak256(stringToBytes(claims.sub));
    payload = intent.payload;
  } else {
    // A DNS domain is a namespace, so the record is named by the label it takes there: `alice_x` in
    // `x.com`, `tim` in `peeramid.xyz`. A flat domain keeps the whole handle, as its records already do.
    const dnsDomain = isDnsName(intent.domain);
    const acct: PlatformAccount & { label?: string } = dnsDomain
      ? pickAccountFor(linked, intent.domain)
      : pickPlatformAccount(linked, intent.domain);
    // A masked record carries the handle exactly as the platform writes it, because nothing about it
    // reaches the chain: the name is a one-time pad, and only a view code opens it. The label rule is
    // for public records, which are read as a name.
    if (intent.optIn) {
      viewCode = deriveViewCode(secrets.viewcodeKey, intent.domain, acct.subject);
      name = maskName(storable(acct.username, acct.label), viewCode);
      // A platform id longer than a name can hold is hashed first, so two long ids can never collide
      // into one record; the mask is the same either way.
      id = maskedId(acct.subject, viewCode);
      payload = viewCodeCommitment(viewCode);
    } else {
      name = toBytes32(storable(acct.label ?? acct.username, acct.label));
      id = idToBytes32(acct.subject);
      payload = zeroHash;
    }
  }

  // Opt-in is immutable: a different account or a flipped opt-in derives a different id.
  if (onchainId !== zeroHash && id !== onchainId)
    throw new Error("record: id mismatch — account or opt-in changed");

  const record: RegisterMessage = {
    name,
    id,
    domainName: toBytes32(intent.domain),
    validUntil: BigInt(env.now + (env.termSeconds ?? 30 * DAY)),
    nonce: intent.nonce,
    wallet: intent.wallet,
    payload,
  };

  const signature = await signRecord(record, secrets.registrarKey, env);

  let box: AttestResult["viewCode"];
  if (viewCode) {
    const seed = hmac(
      sha256,
      hexToBytes(secrets.viewcodeKey),
      concatBytes(stringToBytes("ecies"), hexToBytes(intent.pubkey), hexToBytes(viewCode))
    );
    box = eciesEncrypt(intent.pubkey, hexToBytes(viewCode), seed);
  }

  return { record, signature, viewCode: box };
}

/** Full pipeline: public leg then confidential leg. Node fallback and tests use this. */
export async function attest(
  req: AttestRequest,
  onchain: OnchainState,
  secrets: RegistrarSecrets,
  env: AttestEnv
): Promise<AttestResult> {
  await verifyPublicLeg(req, onchain, env);
  return attestConfidential(req, onchain.exists ? onchain.id : zeroHash, secrets, env);
}
