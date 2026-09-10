import { describe, expect, it, vi } from "vitest";
import { stringToBytes, type Hex } from "viem";
import {
  hashToField,
  rpSignatureMessage,
  signRequest,
  verifyHumanProof,
  worldFrom,
  type WorldConfig,
} from "../../src/world.js";

/**
 * Every constant here is copied from https://docs.world.org/world-id/idkit/signatures — the published
 * test vectors for `hash_to_field`, `compute_rp_signature_message` and `sign_request`. They are the
 * only way to tell a signature this deployment produces from one World will accept without holding a
 * Developer Portal account: a request World rejects is indistinguishable from a user who declined.
 */
const VECTOR_KEY = "0xabababababababababababababababababababababababababababababababab" as const;
const VECTOR_NONCE = "0x008ae1aa597fa146ebd3aa2ceddf360668dea5e526567e92b0321816a4e895bd" as const;
const VECTOR_RANDOM = new Uint8Array(Array.from({ length: 32 }, (_, i) => i));
const VECTOR_CREATED_AT = 1_700_000_000;
const VECTOR_EXPIRES_AT = 1_700_000_300;

const world: WorldConfig = {
  appId: "app_test",
  rpId: "rp_test",
  action: "humanity",
  signingKey: VECTOR_KEY,
  verifyUrl: "https://developer.world.org",
  environment: "production",
  credential: "selfie",
  // Empty: accept whatever World verified, which is what the widget was asked for.
  levels: [],
};

/** A legacy (3.0) uniqueness proof as IDKit hands it over, shaped as the docs' response example. */
const proofFor = (signal: string, over: Record<string, unknown> = {}) => ({
  protocol_version: "3.0" as const,
  nonce: VECTOR_NONCE,
  action: "humanity",
  environment: "production",
  responses: [
    {
      identifier: "orb",
      signal_hash: hashToField(stringToBytes(signal)),
      proof: "0x1a2b3c",
      merkle_root: "0x0abc123",
      nullifier: "0x2bf8406809dcefb1486dadc96c0a897db9bab002053054cf64272db512c6fbd8",
    },
  ],
  user_presence_completed: false,
  ...over,
});

/** The Developer Portal's answer, per the OpenAPI schema on /api-reference/developer-portal/verify. */
const portal = (status: number, body: unknown) =>
  vi.fn(
    async () =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
  );

const accepted = (over: Record<string, unknown> = {}) =>
  portal(200, {
    success: true,
    action: "humanity",
    nullifier: "0x2bf8406809dcefb1486dadc96c0a897db9bab002053054cf64272db512c6fbd8",
    created_at: "2026-01-01T00:00:00.000Z",
    environment: "production",
    results: [
      {
        identifier: "orb",
        success: true,
        nullifier: "0x2bf8406809dcefb1486dadc96c0a897db9bab002053054cf64272db512c6fbd8",
      },
    ],
    ...over,
  });

describe("the World ID request signature", () => {
  it("hashes to a field element exactly as World publishes it", () => {
    // hash_to_field is keccak-256 shifted right 8 bits. Get the shift wrong and every signature and
    // every signal binding is silently wrong: World rejects the request and the user sees nothing.
    expect(hashToField(new Uint8Array())).toBe(
      "0x00c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a4"
    );
    expect(hashToField(stringToBytes("test_signal"))).toBe(
      "0x00c1636e0a961a3045054c4d61374422c31a95846b8442f0927ad2ff1d6112ed"
    );
    expect(hashToField(new Uint8Array([0x01, 0x02, 0x03]))).toBe(
      "0x00f1885eda54b7a053318cd41e2093220dab15d65381b1157a3633a83bfd5c92"
    );
    expect(hashToField(stringToBytes("hello"))).toBe(
      "0x001c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36dea"
    );
  });

  it("lays the message out as 49 bytes without an action and 81 with one", () => {
    // The layout is positional — version byte, nonce, two big-endian uint64s, the hashed action — and
    // the EIP-191 prefix carries the length, so one byte out of place changes the digest entirely.
    expect(rpSignatureMessage(VECTOR_NONCE, VECTOR_CREATED_AT, VECTOR_EXPIRES_AT)).toBe(
      "0x01008ae1aa597fa146ebd3aa2ceddf360668dea5e526567e92b0321816a4e895bd000000006553f100000000006553f22c"
    );
    expect(rpSignatureMessage(VECTOR_NONCE, VECTOR_CREATED_AT, VECTOR_EXPIRES_AT, "test-action")).toBe(
      "0x01008ae1aa597fa146ebd3aa2ceddf360668dea5e526567e92b0321816a4e895bd000000006553f100000000006553f22c00aa0ce59768ae5b1c52f07a9387f14f09f277422c0d2f8a268c7bad0c60a46a"
    );
  });

  it("signs a request byte-for-byte as the published vectors do", async () => {
    // This is the whole point of the file: World verifies this signature before it will issue a proof
    // at all, so a drift here takes the humanity check down with no error anyone here can see.
    const withAction = await signRequest({
      signingKey: VECTOR_KEY,
      action: "test-action",
      createdAt: VECTOR_CREATED_AT,
      random: VECTOR_RANDOM,
    });
    expect(withAction).toEqual({
      sig: "0x05594adb6c1495768a38d523d7d6ee6356b2c31231919198794ed022ade7d08f73753f83bd167067d99c9b969d28e9222315837c66af25867b041273a6d5056f1b",
      nonce: VECTOR_NONCE,
      createdAt: VECTOR_CREATED_AT,
      expiresAt: VECTOR_EXPIRES_AT,
    });

    const withoutAction = await signRequest({
      signingKey: VECTOR_KEY,
      createdAt: VECTOR_CREATED_AT,
      random: VECTOR_RANDOM,
    });
    expect(withoutAction.sig).toBe(
      "0x14f693175773aed912852a601e9c0fd30f2afe2738d31388316232ce6f64ae9e4edbfb19d81c4229ba9c9fca78ede4b28956b7ba4415f08d957cbc1b3bdaa4021b"
    );
  });

  it("honours a ttl other than the default five minutes", () => {
    // The window is what stops a captured signature being replayed into a proof request tomorrow.
    return expect(
      signRequest({ signingKey: VECTOR_KEY, createdAt: VECTOR_CREATED_AT, random: VECTOR_RANDOM, ttl: 60 })
    ).resolves.toMatchObject({ expiresAt: VECTOR_CREATED_AT + 60 });
  });
});

describe("verifying a World ID proof", () => {
  it("forwards the IDKit result verbatim to the RP's verify endpoint", async () => {
    // The docs are explicit that no field may be remapped and no legacy verification_level built. A
    // helpfully "cleaned up" payload is the failure mode this asserts against.
    const fetchImpl = accepted();
    const proof = proofFor("0xalice");
    await verifyHumanProof(world, proof, "0xalice", fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://developer.world.org/api/v4/verify/rp_test");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(proof);
  });

  it("returns the nullifier as padded bytes32 and the credential as the level", async () => {
    // The record on chain is keyed by the nullifier, so it has to be one canonical 32-byte value: the
    // docs warn that parsing and casing differences here are a security bug, and they would be — the
    // same human would look like two people and get two accounts.
    const short = "0xABC";
    const result = await verifyHumanProof(
      world,
      proofFor("0xalice"),
      "0xalice",
      accepted({ nullifier: short, results: [{ identifier: "orb", success: true, nullifier: short }] })
    );
    expect(result.nullifier).toBe(`0x${"0".repeat(61)}abc`);
    expect(result.level).toBe("orb");
  });

  it("refuses a proof made for a different action", async () => {
    // An action scopes the nullifier. A proof minted for some other action of this same app is a
    // valid proof of a different statement, and accepting it would let one human hold many accounts.
    const fetchImpl = accepted();
    await expect(
      verifyHumanProof(world, proofFor("0xalice", { action: "some-other-action" }), "0xalice", fetchImpl)
    ).rejects.toThrow(/action/);
    // And it never reached the portal: a wrong action is decided here, not paid for over the network.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a proof bound to somebody else's wallet", async () => {
    // The signal is what ties the proof to the wallet asking. Without this check anyone could replay a
    // proof they watched go past and bind another person's humanity to their own account.
    const fetchImpl = accepted();
    await expect(verifyHumanProof(world, proofFor("0xbob"), "0xalice", fetchImpl)).rejects.toThrow(/signal/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a session proof, which carries no per-action nullifier", async () => {
    // World ID 4.0 session proofs identify a returning user by session_id and their nullifier is
    // per-proof. One human, one account needs the stable per-action nullifier instead.
    await expect(
      verifyHumanProof(
        world,
        {
          protocol_version: "4.0",
          nonce: VECTOR_NONCE,
          session_id: `session_${"a".repeat(128)}`,
          responses: [],
        },
        "0xalice",
        accepted()
      )
    ).rejects.toThrow(/session/);
  });

  it("reports what the portal said when it rejects the proof", async () => {
    // `invalid_proof` and `already_verified` mean different things to the person on the other end, so
    // the reason has to survive to the caller rather than becoming a bare 400.
    await expect(
      verifyHumanProof(
        world,
        proofFor("0xalice"),
        "0xalice",
        portal(400, {
          success: false,
          code: "all_verifications_failed",
          detail: "All proof verifications failed.",
        })
      )
    ).rejects.toThrow(/all_verifications_failed.*All proof verifications failed/);
  });

  it("refuses an answer whose action is not the one this deployment asked about", async () => {
    // The portal echoes the action it verified. Trusting our own copy of the request rather than its
    // answer would make the check above cosmetic.
    await expect(
      verifyHumanProof(world, proofFor("0xalice"), "0xalice", accepted({ action: "somebody-elses" }))
    ).rejects.toThrow(/action/);
  });

  it("refuses an answer with no nullifier in it", async () => {
    // A 200 with nothing to key the record on is not a verification; writing a record with a zero id
    // would collide with the next one.
    await expect(
      verifyHumanProof(world, proofFor("0xalice"), "0xalice", accepted({ nullifier: undefined, results: [] }))
    ).rejects.toThrow(/nullifier/);
  });

  it("refuses a credential name too long to store as the record's payload", async () => {
    // The level is written into a Multipass payload, which is a left-aligned bytes32: 31 bytes and no
    // more. Truncating it would report a level nobody asked for.
    await expect(
      verifyHumanProof(
        world,
        proofFor("0xalice"),
        "0xalice",
        accepted({ results: [{ identifier: "a".repeat(32), success: true, nullifier: "0x01" }] })
      )
    ).rejects.toThrow(/level/);
  });

  it("takes the nullifier from the successful credential when the answer has no top-level one", async () => {
    // A multi-credential request answers per credential; the one that succeeded is the one that says
    // who this is.
    const result = await verifyHumanProof(
      world,
      proofFor("0xalice"),
      "0xalice",
      accepted({
        nullifier: undefined,
        results: [
          { identifier: "document", success: false, code: "verification_error", detail: "no" },
          { identifier: "orb", success: true, nullifier: "0x2bf84068" },
        ],
      })
    );
    expect(result.level).toBe("orb");
    expect(result.nullifier.endsWith("2bf84068")).toBe(true);
  });

  it("refuses a nullifier that is not a 256-bit number", async () => {
    // The nullifier becomes a record id on chain. Anything that is not one canonical number would
    // either throw deep inside the write or, worse, land as a different id than the same human's last.
    await expect(
      verifyHumanProof(world, proofFor("0xalice"), "0xalice", accepted({ nullifier: "not-hex" }))
    ).rejects.toThrow(/unusable nullifier/);
  });

  it("refuses a proof with no signal in it at all", async () => {
    // An absent signal_hash is not "bound to nothing", it is unbound: the proof would be spendable on
    // any wallet that got hold of it.
    const unbound = proofFor("0xalice");
    delete (unbound.responses[0] as Record<string, unknown>).signal_hash;
    await expect(verifyHumanProof(world, unbound, "0xalice", accepted())).rejects.toThrow(/signal/);
  });

  it("reports a bare HTTP failure when the portal answers with nothing readable", async () => {
    // A gateway between here and World answers HTML, not JSON. That has to read as a failure with a
    // status rather than as a verification.
    const html = vi.fn(async () => new Response("<html>502</html>", { status: 502 }));
    await expect(verifyHumanProof(world, proofFor("0xalice"), "0xalice", html)).rejects.toThrow(/HTTP 502/);
  });
});

describe("the World configuration", () => {
  it("is absent until every part of it is set", () => {
    // Half-configured is the dangerous state: an app id with no signing key would offer a check that
    // can never complete. Unset means the CTA stays honest about being unavailable.
    const full = {
      WORLD_APP_ID: "app_test",
      WORLD_RP_ID: "rp_test",
      WORLD_ACTION: "humanity",
      WORLD_RP_SIGNING_KEY: VECTOR_KEY as Hex,
      WORLD_VERIFY_URL: "https://developer.world.org",
      WORLD_ENVIRONMENT: "production" as const,
      WORLD_CREDENTIAL: "selfie" as const,
      WORLD_LEVELS: [],
    };
    expect(worldFrom(full)).toEqual(world);
    expect(worldFrom({ ...full, WORLD_APP_ID: undefined })).toBeUndefined();
    expect(worldFrom({ ...full, WORLD_RP_ID: undefined })).toBeUndefined();
    expect(worldFrom({ ...full, WORLD_RP_SIGNING_KEY: undefined })).toBeUndefined();
  });
});

/**
 * The widget is asked for one credential and the browser hands back whatever it was given. Asking for
 * Selfie Check and accepting an Orb proof would make the choice cosmetic.
 */
describe("which credential this deployment accepts", () => {
  const pinned = (levels: string[]): WorldConfig => ({ ...world, levels });
  const verified = (identifier: string) =>
    portal(200, {
      success: true,
      action: "humanity",
      nullifier: "0x2bf8406809dcefb1486dadc96c0a897db9bab002053054cf64272db512c6fbd8",
      results: [
        {
          identifier,
          success: true,
          nullifier: "0x2bf8406809dcefb1486dadc96c0a897db9bab002053054cf64272db512c6fbd8",
        },
      ],
    });
  const proofOf = (identifier: string) =>
    proofFor("0xreader", {
      responses: [{ identifier, signal_hash: hashToField(stringToBytes("0xreader")) }],
    });

  it("accepts anything World verified when nothing is pinned", async () => {
    const got = await verifyHumanProof(world, proofOf("orb"), "0xreader", verified("orb"));
    expect(got.level).toBe("orb");
  });

  it("refuses a credential the deployment does not accept", async () => {
    await expect(
      verifyHumanProof(pinned(["selfie"]), proofOf("orb"), "0xreader", verified("orb"))
    ).rejects.toThrow('does not accept a "orb" credential');
  });

  it("accepts the one it does", async () => {
    const got = await verifyHumanProof(pinned(["selfie"]), proofOf("selfie"), "0xreader", verified("selfie"));
    expect(got.level).toBe("selfie");
  });
});
