import { describe, expect, it } from "vitest";
import { bytesToHex, keccak256, recoverTypedDataAddress, stringToBytes, zeroHash } from "viem";
import { decodeRecord, fromBytes32, registerNameTypes, toBytes32 } from "@peeramid-labs/multipass-client";
import { attest, attestConfidential, idToBytes32, verifyPublicLeg } from "../src/attest.js";
import { eciesDecrypt } from "../src/ecies.js";
import {
  DID,
  defaultLinked,
  env,
  makeIntent,
  mintIdToken,
  makeInvite,
  noRecord,
  noVouchRecord,
  NOW,
  registrarAccount,
  secrets,
  signedRequest,
  USER_KEY,
  userAccount,
} from "./fixtures.js";

async function recoverRegistrar(result: Awaited<ReturnType<typeof attest>>) {
  return recoverTypedDataAddress({
    domain: { ...env.eip712, chainId: env.chainId, verifyingContract: env.multipass },
    types: registerNameTypes,
    primaryType: "registerName",
    message: result.record,
    signature: result.signature,
  });
}

describe("attest — platform domain, public record", () => {
  it("signs a record the Multipass contract will accept", async () => {
    const req = await signedRequest(makeIntent());
    const res = await attest(req, noRecord, secrets, env);

    expect(res.record).toEqual({
      name: toBytes32("alice"),
      id: toBytes32("1234567890123456789"),
      domainName: toBytes32("x"),
      validUntil: BigInt(NOW + 30 * 86400),
      nonce: 1n,
      wallet: userAccount.address,
      payload: zeroHash,
    });
    expect(await recoverRegistrar(res)).toBe(registrarAccount.address);
    expect(res.viewCode).toBeUndefined();
  });

  it("is deterministic (consensus-safe)", async () => {
    const req = await signedRequest(makeIntent());
    const a = await attest(req, noRecord, secrets, env);
    const b = await attest(req, noRecord, secrets, env);
    expect(a).toEqual(b);
  });

  it("honours termSeconds", async () => {
    const req = await signedRequest(makeIntent());
    const res = await attest(req, noRecord, secrets, { ...env, termSeconds: 60 });
    expect(res.record.validUntil).toBe(BigInt(NOW + 60));
  });

  it("maps telegram / google / email accounts", async () => {
    for (const [domain, name, id] of [
      ["telegram", "alice_tg", "987654321"],
      ["google", "alice@example.com", "10987654321098765432"],
      ["email", "alice@example.com", "alice@example.com"],
    ] as const) {
      const res = await attest(await signedRequest(makeIntent({ domain })), noRecord, secrets, env);
      expect(fromBytes32(res.record.name)).toBe(name);
      expect(fromBytes32(res.record.id)).toBe(id);
    }
  });
});

describe("attest — platform domain, opted in", () => {
  it("masks name/id, commits the view code, and encrypts it to the user", async () => {
    const req = await signedRequest(makeIntent({ optIn: true }));
    const res = await attest(req, noRecord, secrets, env);

    expect(res.record.payload).not.toBe(zeroHash);
    expect(res.record.name).not.toBe(toBytes32("alice"));
    expect(res.viewCode).toBeDefined();

    const viewCode = bytesToHex(eciesDecrypt(USER_KEY, res.viewCode!));
    expect(decodeRecord(res.record, viewCode)).toEqual({
      handle: "alice",
      platformId: "1234567890123456789",
    });
    expect(await recoverRegistrar(res)).toBe(registrarAccount.address);
  });

  it("encryption is deterministic across replicas", async () => {
    const req = await signedRequest(makeIntent({ optIn: true }));
    const a = await attest(req, noRecord, secrets, env);
    const b = await attest(req, noRecord, secrets, env);
    expect(a.viewCode).toEqual(b.viewCode);
  });

  it("renewal keeps the same id; flipping opt-in is rejected", async () => {
    const first = await attest(await signedRequest(makeIntent({ optIn: true })), noRecord, secrets, env);
    const onchain = { exists: true, nonce: 1n, id: first.record.id, wallet: userAccount.address };

    const renew = await attest(
      await signedRequest(makeIntent({ optIn: true, nonce: 2n })),
      onchain,
      secrets,
      env
    );
    expect(renew.record.id).toBe(first.record.id);
    expect(renew.record.nonce).toBe(2n);

    await expect(
      attest(await signedRequest(makeIntent({ optIn: false, nonce: 2n })), onchain, secrets, env)
    ).rejects.toThrow("record: id mismatch");
  });
});

describe("attest — name domain (kju-is as a config value)", () => {
  it("uses the handle as name, keccak(DID) as id, answer as payload", async () => {
    const payload = toBytes32("terrible dictator");
    const req = await signedRequest(makeIntent({ domain: "kju-is", handle: "alice", payload }));
    const res = await attest(req, noRecord, secrets, env);
    expect(res.record.name).toBe(toBytes32("alice"));
    expect(res.record.id).toBe(keccak256(stringToBytes(DID)));
    expect(res.record.payload).toBe(payload);
  });

  it("rejects opt-in and invalid handles", async () => {
    await expect(
      attest(
        await signedRequest(makeIntent({ domain: "kju-is", handle: "alice", optIn: true })),
        noRecord,
        secrets,
        env
      )
    ).rejects.toThrow("opt-in not allowed");
    await expect(
      attest(await signedRequest(makeIntent({ domain: "kju-is", handle: "Alice" })), noRecord, secrets, env)
    ).rejects.toThrow("invalid handle");
  });
});

describe("attest — vouch instance (~candidate) domain", () => {
  it("treats ~<candidate> as a name domain: voucher handle, keccak(DID), statement", async () => {
    const statement = toBytes32("worked together 2019-22");
    const req = await signedRequest(
      makeIntent({ domain: "~alice", handle: "bob", payload: statement }),
      undefined,
      undefined,
      await makeInvite()
    );
    const res = await attest(req, noVouchRecord, secrets, env);
    expect(res.record.domainName).toBe(toBytes32("~alice"));
    expect(res.record.name).toBe(toBytes32("bob"));
    expect(res.record.id).toBe(keccak256(stringToBytes(DID)));
    expect(res.record.payload).toBe(statement);
  });

  it("a bare prefix or a disabled prefix list is not a name domain", async () => {
    await expect(
      attest(await signedRequest(makeIntent({ domain: "~", handle: "bob" })), noRecord, secrets, env)
    ).rejects.toThrow("unknown domain");
    await expect(
      attest(await signedRequest(makeIntent({ domain: "~alice", handle: "bob" })), noRecord, secrets, {
        ...env,
        nameDomainPrefixes: [],
      })
    ).rejects.toThrow("unknown domain");
  });

  it("needs the candidate's invitation: nobody writes into a stranger's vouch domain", async () => {
    const intent = makeIntent({ domain: "~alice", handle: "bob", payload: toBytes32("hi") });
    const vouch = (invite?: Awaited<ReturnType<typeof makeInvite>>, onchain = noVouchRecord) =>
      signedRequest(intent, undefined, undefined, invite).then((req) => verifyPublicLeg(req, onchain, env));

    await expect(vouch()).rejects.toThrow("invite: ~alice needs the candidate's invitation");
    await expect(vouch(await makeInvite({ handle: "carol" }))).rejects.toThrow("for a different candidate");
    await expect(vouch(await makeInvite({ exp: BigInt(NOW - 1) }))).rejects.toThrow("invite: expired");
    await expect(vouch(await makeInvite({ voucher: registrarAccount.address }))).rejects.toThrow(
      "issued to a different wallet"
    );
    await expect(vouch(await makeInvite({}, registrarAccount))).rejects.toThrow(
      "not signed by the candidate"
    );
    await expect(
      vouch(await makeInvite(), { ...noVouchRecord, candidateWallet: undefined } as never)
    ).rejects.toThrow("alice holds no live name to invite from");

    // The open invitation, and one issued to this exact voucher, both pass.
    await expect(vouch(await makeInvite())).resolves.toBeUndefined();
    await expect(vouch(await makeInvite({ voucher: userAccount.address }))).resolves.toBeUndefined();
  });

  it("a voucher who already holds a record there may update or withdraw it without a new invitation", async () => {
    const intent = makeIntent({
      domain: "~alice",
      handle: "bob",
      nonce: 2n,
      payload: toBytes32("withdrawn"),
    });
    const held = { ...noVouchRecord, exists: true, nonce: 1n, wallet: userAccount.address };
    await expect(verifyPublicLeg(await signedRequest(intent), held, env)).resolves.toBeUndefined();
  });

  it("an onboarded organisation issues a reference for a handle nobody has claimed yet", async () => {
    const intent = makeIntent({
      domain: "~alice",
      handle: "acme-university",
      payload: toBytes32("graduated 2021"),
    });
    // No invitation, and the candidate holds no name: the university writes first, Alice claims later.
    const asOrg = { exists: false, nonce: 0n, id: zeroHash, wallet: userAccount.address, issuerOrg: true };
    await expect(verifyPublicLeg(await signedRequest(intent), asOrg, env)).resolves.toBeUndefined();

    const asPerson = { ...asOrg, issuerOrg: false };
    await expect(verifyPublicLeg(await signedRequest(intent), asPerson, env)).rejects.toThrow(
      "needs the candidate's invitation"
    );
  });

  it("refuses a handle a platform namespace already owns", async () => {
    // Every platform has its own instance under the root, so `x.<root>` holds `alice.x.<root>`. A
    // person taking the handle `x` would own that same name.
    for (const handle of ["x", "github", "email", "www", "com", "reverse"]) {
      await expect(
        attest(await signedRequest(makeIntent({ domain: "kju-is", handle })), noRecord, secrets, env)
      ).rejects.toThrow(`"${handle}" is a reserved handle`);
    }
    // A vouch domain is the candidate's own namespace, so anything goes there.
    await expect(
      verifyPublicLeg(
        await signedRequest(
          makeIntent({ domain: "~alice", handle: "github" }),
          undefined,
          undefined,
          await makeInvite()
        ),
        noVouchRecord,
        env
      )
    ).resolves.toBeUndefined();
    // And a deployment can choose its own list.
    await expect(
      attest(await signedRequest(makeIntent({ domain: "kju-is", handle: "x" })), noRecord, secrets, {
        ...env,
        reservedHandles: ["only-this"],
      })
    ).resolves.toMatchObject({ record: { name: toBytes32("x") } });
  });

  it("a deployment may switch invitations off", async () => {
    const req = await signedRequest(makeIntent({ domain: "~alice", handle: "bob" }));
    await expect(verifyPublicLeg(req, noRecord, { ...env, requireInvite: false })).resolves.toBeUndefined();
  });
});

describe("verifyPublicLeg", () => {
  it("rejects unknown domain", async () => {
    await expect(
      verifyPublicLeg(await signedRequest(makeIntent({ domain: "myspace" })), noRecord, env)
    ).rejects.toThrow("unknown domain");
  });

  it("rejects a signature from another wallet", async () => {
    const req = await signedRequest(makeIntent(), mintIdToken(), registrarAccount);
    await expect(verifyPublicLeg(req, noRecord, env)).rejects.toThrow("bad signature");
  });

  it("rejects expired intent", async () => {
    await expect(
      verifyPublicLeg(await signedRequest(makeIntent({ exp: BigInt(NOW) })), noRecord, env)
    ).rejects.toThrow("expired");
  });

  it("rejects non-increasing nonce and nonce 0", async () => {
    const onchain = { exists: true, nonce: 3n, id: toBytes32("x"), wallet: userAccount.address };
    await expect(
      verifyPublicLeg(await signedRequest(makeIntent({ nonce: 3n })), onchain, env)
    ).rejects.toThrow("nonce not increasing");
    await expect(
      verifyPublicLeg(await signedRequest(makeIntent({ nonce: 0n })), noRecord, env)
    ).rejects.toThrow("nonce must be >= 1");
  });

  it("rejects wallet rebinding on renewal", async () => {
    const onchain = { exists: true, nonce: 1n, id: toBytes32("x"), wallet: registrarAccount.address };
    await expect(
      verifyPublicLeg(await signedRequest(makeIntent({ nonce: 2n })), onchain, env)
    ).rejects.toThrow("wallet mismatch");
  });

  it("honours platformDomains and nameDomains allow-lists", async () => {
    await expect(
      verifyPublicLeg(await signedRequest(makeIntent()), noRecord, { ...env, platformDomains: ["telegram"] })
    ).rejects.toThrow("unknown domain");
    await expect(
      verifyPublicLeg(await signedRequest(makeIntent({ domain: "kju-is", handle: "a" })), noRecord, {
        ...env,
        nameDomains: ["uni"],
      })
    ).rejects.toThrow("unknown domain");
    await verifyPublicLeg(await signedRequest(makeIntent({ domain: "uni", handle: "a" })), noRecord, {
      ...env,
      nameDomains: ["uni"],
    });
  });
});

describe("attestConfidential — identity checks", () => {
  it("rejects when the wallet is not linked to the DID", async () => {
    const linked = defaultLinked().filter((a) => a.type !== "wallet");
    const req = await signedRequest(makeIntent(), mintIdToken(linked));
    await expect(attestConfidential(req, zeroHash, secrets, env)).rejects.toThrow("wallet not linked");
  });

  it("rejects when the platform account is missing", async () => {
    const linked = defaultLinked().filter((a) => a.type !== "twitter_oauth");
    const req = await signedRequest(makeIntent(), mintIdToken(linked));
    await expect(attestConfidential(req, zeroHash, secrets, env)).rejects.toThrow("no linked twitter_oauth");
  });

  it("rejects a token signed by another key", async () => {
    const req = await signedRequest(
      makeIntent(),
      mintIdToken(undefined, { signWith: new Uint8Array(32).fill(7) })
    );
    await expect(attestConfidential(req, zeroHash, secrets, env)).rejects.toThrow("invalid signature");
  });
});

describe("idToBytes32", () => {
  it("keeps short ids verbatim and hashes long ones", () => {
    expect(idToBytes32("abc")).toBe(toBytes32("abc"));
    const long = "x".repeat(40);
    expect(idToBytes32(long)).toBe(keccak256(stringToBytes(long)));
  });
});
