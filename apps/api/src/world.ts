import { concatHex, hexToBytes, keccak256, numberToHex, stringToBytes, type Hex } from "viem";
import { signMessage } from "viem/accounts";

/**
 * World ID: proof that one human stands behind one account.
 *
 * Two documented pieces, and nothing invented between them:
 *   - the RP signature every proof request must carry, spec and test vectors at
 *     https://docs.world.org/world-id/idkit/signatures
 *   - cloud verification of what IDKit hands back, at
 *     https://docs.world.org/api-reference/developer-portal/verify (POST /api/v4/verify/{rp_id}),
 *     which the integration guide (https://docs.world.org/world-id/idkit/integrate) says to forward
 *     verbatim: no field remapping, no locally built `verification_level`.
 *
 * The uniqueness of a person is the nullifier, and it is only unique per action, so the action is a
 * deployment argument like every other subject here.
 */
export type WorldConfig = {
  appId: string;
  rpId: string;
  action: string;
  signingKey: Hex;
  verifyUrl: string;
  environment: "production" | "staging";
  /** Which credential the widget asks for; the browser cannot be trusted to pick it */
  credential: "proof_of_human" | "selfie";
  /** Credentials a verified proof may carry, or empty to accept whatever World verified */
  levels: string[];
};

/** What the config carries; absent unless every part of it is set. */
export function worldFrom(c: {
  WORLD_APP_ID?: string;
  WORLD_RP_ID?: string;
  WORLD_ACTION: string;
  WORLD_RP_SIGNING_KEY?: Hex;
  WORLD_VERIFY_URL: string;
  WORLD_ENVIRONMENT: "production" | "staging";
  WORLD_CREDENTIAL: "proof_of_human" | "selfie";
  WORLD_LEVELS: string[];
}): WorldConfig | undefined {
  if (!c.WORLD_APP_ID || !c.WORLD_RP_ID || !c.WORLD_RP_SIGNING_KEY) return undefined;
  /*
   * A staging app is a different app, not a mode of the production one: the QR a staging request
   * produces points at the simulator, and a production app id will not answer for it whatever the
   * environment says. The two are set separately and there is nothing at the World end that reports
   * the mismatch, so the QR simply points at the wrong place — which reads as the widget being broken.
   */
  const staging = c.WORLD_APP_ID.startsWith("app_staging_");
  if (staging !== (c.WORLD_ENVIRONMENT === "staging")) {
    throw new Error(
      `world: WORLD_APP_ID ${c.WORLD_APP_ID} is ${staging ? "a staging" : "a production"} app but ` +
        `WORLD_ENVIRONMENT is "${c.WORLD_ENVIRONMENT}". A staging app id begins app_staging_, and the ` +
        `environment has to match it, or the widget offers a code the app cannot answer.`
    );
  }
  return {
    appId: c.WORLD_APP_ID,
    rpId: c.WORLD_RP_ID,
    action: c.WORLD_ACTION,
    signingKey: c.WORLD_RP_SIGNING_KEY,
    verifyUrl: c.WORLD_VERIFY_URL.replace(/\/$/, ""),
    environment: c.WORLD_ENVIRONMENT,
    credential: c.WORLD_CREDENTIAL,
    levels: c.WORLD_LEVELS,
  };
}

/**
 * keccak-256 shifted right by 8 bits, so the result always fits the circuit's field element and
 * always starts with `0x00`. World hashes both the action and the signal this way.
 */
export function hashToField(input: Uint8Array): Hex {
  return numberToHex(BigInt(keccak256(input)) >> 8n, { size: 32 });
}

/**
 * The bytes IDKit hashes for a signal, which is not simply the text of it.
 *
 * A signal that reads as hex is hashed as the bytes it spells; anything else is hashed as UTF-8 text.
 * The wallet this app binds proofs to is hex, so hashing its 42 characters gives a different field
 * element from the 20 bytes IDKit hashed, and every sound proof fails the binding check. Mirrored from
 * `hashSignal` in @worldcoin/idkit-core rather than guessed.
 */
export function hashSignal(signal: string): Hex {
  const body = signal.startsWith("0x") ? signal.slice(2) : "";
  const isHex = body.length > 0 && body.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(body);
  return hashToField(isHex ? hexToBytes(`0x${body}`) : stringToBytes(signal));
}

/**
 * The bytes an RP signature covers: a version byte, the nonce, two big-endian uint64 timestamps and,
 * for a uniqueness request, the hashed action. 49 bytes without an action, 81 with one — the EIP-191
 * prefix carries that length, so the layout is part of the digest.
 */
export function rpSignatureMessage(nonce: Hex, createdAt: number, expiresAt: number, action?: string): Hex {
  return concatHex([
    "0x01",
    nonce,
    numberToHex(BigInt(createdAt), { size: 8 }),
    numberToHex(BigInt(expiresAt), { size: 8 }),
    ...(action === undefined ? [] : [hashToField(stringToBytes(action))]),
  ]);
}

/**
 * Sign a proof request as this app. World refuses to issue a proof for a request it cannot attribute,
 * so this is what makes the widget open at all.
 *
 * The randomness is an argument rather than drawn here: a signature nobody can reproduce is a
 * signature nobody can check against the published vectors.
 */
export async function signRequest(opts: {
  signingKey: Hex;
  action?: string;
  createdAt: number;
  random: Uint8Array;
  ttl?: number;
}): Promise<{ sig: Hex; nonce: Hex; createdAt: number; expiresAt: number }> {
  const nonce = hashToField(opts.random);
  const expiresAt = opts.createdAt + (opts.ttl ?? 300);
  const message = rpSignatureMessage(nonce, opts.createdAt, expiresAt, opts.action);
  // EIP-191 personal-sign over the raw bytes, which is `\x19Ethereum Signed Message:\n<length>` and
  // then r || s || v with v = recovery id + 27 — exactly what the spec asks for.
  const sig = await signMessage({ message: { raw: message }, privateKey: opts.signingKey });
  return { sig, nonce, createdAt: opts.createdAt, expiresAt };
}

/** One credential's answer inside an IDKit result. Everything else travels through untouched. */
type IdkitResponse = { identifier?: unknown; signal_hash?: unknown };

/** What IDKit hands back. Kept loose on purpose: the payload is forwarded to World as it arrived. */
export type IdkitResult = {
  protocol_version?: unknown;
  action?: unknown;
  session_id?: unknown;
  responses?: unknown;
  [key: string]: unknown;
};

/** What the Developer Portal answers, per the OpenAPI schema behind /api/v4/verify/{rp_id}. */
type VerifyAnswer = {
  success?: boolean;
  action?: string;
  nullifier?: string;
  code?: string;
  detail?: string;
  results?: { identifier?: string; success?: boolean; nullifier?: string }[];
};

export type HumanProof = { nullifier: Hex; level: string };

/** Just enough of `fetch` to be replaceable in a test without pretending to be the whole of it. */
export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** A Multipass name or payload is a left-aligned bytes32, so 31 bytes is the whole budget. */
const STORABLE_BYTES = 31;

/** Two hex strings holding the same field element, whatever width each was written at. */
function sameField(a: string, b: string): boolean {
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(a) || !/^0x[0-9a-fA-F]{1,64}$/.test(b)) return false;
  return BigInt(a) === BigInt(b);
}

/**
 * Canonical form of a nullifier: a 256-bit integer, padded to bytes32.
 *
 * World returns it as a 0x-prefixed hex string of no fixed width and no fixed casing, and the docs say
 * plainly that parsing it as text is a security bug. It would be: `0xABC` and `0x0abc` are one human,
 * and treating them as two hands that human a second account.
 */
function canonicalNullifier(value: string): Hex {
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(value)) throw new Error(`world: unusable nullifier "${value}"`);
  return numberToHex(BigInt(value), { size: 32 });
}

/**
 * Verify a proof against World, and say which human it is.
 *
 * The two checks before the network call are the ones that make this "one human, one account" rather
 * than "a valid proof exists somewhere": the proof has to be for this deployment's action, and it has
 * to be bound to the wallet asking. World answers neither question — it verifies the mathematics.
 */
export async function verifyHumanProof(
  world: WorldConfig,
  result: IdkitResult,
  signal: string,
  fetchImpl: Fetch
): Promise<HumanProof> {
  if (typeof result.session_id === "string") {
    throw new Error("world: session proofs carry no per-action nullifier; ask for a uniqueness proof");
  }
  if (result.action !== world.action) {
    throw new Error(`world: proof is for action "${String(result.action)}", not "${world.action}"`);
  }
  const responses: IdkitResponse[] = Array.isArray(result.responses) ? result.responses : [];
  const expected = hashSignal(signal);
  for (const r of responses) {
    // Compared as a number, not as text. `hash_to_field` always leaves a leading zero byte, and a hex
    // string carrying that value may or may not keep it — `0x00ab…` and `0xab…` are one hash. The same
    // reasoning is applied to the nullifier below; comparing either as text rejects sound proofs.
    if (typeof r.signal_hash !== "string" || !sameField(r.signal_hash, expected)) {
      throw new Error(
        `world: proof signal is not bound to ${signal} (proof carries ${String(r.signal_hash)}, expected ${expected})`
      );
    }
  }

  const res = await fetchImpl(`${world.verifyUrl}/api/v4/verify/${world.rpId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    // Verbatim: the integration guide says no field may be remapped on the way through.
    body: JSON.stringify(result),
  });
  const answer = (await res.json().catch(() => null)) as VerifyAnswer | null;
  if (!res.ok || answer?.success !== true) {
    const code = answer?.code ?? `HTTP ${res.status}`;
    throw new Error(`world: ${code}${answer?.detail ? `: ${answer.detail}` : ""}`);
  }
  // The portal echoes the action it verified. Reading it back rather than trusting the copy checked
  // above is what keeps that check from being cosmetic.
  if (answer.action !== undefined && answer.action !== world.action) {
    throw new Error(`world: verified action "${answer.action}", not "${world.action}"`);
  }

  const credential = answer.results?.find((r) => r.success);
  const nullifier = answer.nullifier ?? credential?.nullifier;
  if (!nullifier) throw new Error("world: verified, but the answer carries no nullifier");
  const level =
    credential?.identifier ?? (typeof responses[0]?.identifier === "string" ? responses[0].identifier : "");
  if (!level || stringToBytes(level).length > STORABLE_BYTES) {
    throw new Error(`world: level "${level}" does not fit a record payload`);
  }
  // The widget is asked for one credential and the browser hands back whatever it was given. A
  // deployment that has decided which credential it accepts says so here, where it is decided.
  if (world.levels.length > 0 && !world.levels.includes(level)) {
    throw new Error(`world: this deployment does not accept a "${level}" credential`);
  }
  return { nullifier: canonicalNullifier(nullifier), level };
}
