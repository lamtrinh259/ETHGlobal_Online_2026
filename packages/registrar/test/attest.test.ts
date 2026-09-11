import { describe, expect, it } from "vitest";
import { bytesToHex, keccak256, recoverTypedDataAddress, stringToBytes, zeroHash } from "viem";
import {
  decodeRecord,
  deriveViewCode,
  fromBytes32,
  registerNameTypes,
  toBytes32,
} from "@peeramid-labs/multipass-client";
import { attest, attestConfidential, idToBytes32, solicitedBy, verifyPublicLeg } from "../src/attest.js";
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

  it("lets anyone write a reference, and reports whether the candidate asked for it", async () => {
    // Non-permissioned by design: a reference is a claim its writer signs, and it carries the weight of
    // who they are. Whether the subject asked is a fact about the reference, not permission to make one.
    const intent = makeIntent({ domain: "~alice", handle: "bob", payload: toBytes32("hi") });
    const vouch = (invite?: Awaited<ReturnType<typeof makeInvite>>, onchain = noVouchRecord) =>
      signedRequest(intent, undefined, undefined, invite).then((req) => verifyPublicLeg(req, onchain, env));
    const asked = (invite?: Awaited<ReturnType<typeof makeInvite>>, onchain = noVouchRecord) =>
      signedRequest(intent, undefined, undefined, invite).then((req) => solicitedBy(req, onchain, env));

    // Nobody is turned away, invitation or not.
    await expect(vouch()).resolves.toBeUndefined();
    await expect(vouch(await makeInvite())).resolves.toBeUndefined();

    // And the invitation is reported only when it really is the candidate's, checked against the
    // wallet that holds their name — anyone can sign an "invitation" from themselves.
    expect(await asked()).toBe(false);
    expect(await asked(await makeInvite())).toBe(true);
    expect(await asked(await makeInvite({ voucher: userAccount.address }))).toBe(true);
    expect(await asked(await makeInvite({ handle: "carol" }))).toBe(false);
    expect(await asked(await makeInvite({ exp: BigInt(NOW - 1) }))).toBe(false);
    expect(await asked(await makeInvite({ voucher: registrarAccount.address }))).toBe(false);
    expect(await asked(await makeInvite({}, registrarAccount))).toBe(false);
    expect(await asked(await makeInvite(), { ...noVouchRecord, candidateWallet: undefined } as never)).toBe(
      false
    );
  });

  it("does not count an invitation whose terms the writer does not meet", async () => {
    // "Only from someone with a university address" is a real thing to ask. The writer is not turned
    // away — anyone may refer anyone — but the reference cannot claim the candidate asked for it.
    const intent = makeIntent({ domain: "~alice", handle: "bob", payload: toBytes32("hi") });
    const invite = await makeInvite({ requires: ["mit.edu"] });
    const asked = (writerDomains: string[]) =>
      signedRequest(intent, undefined, undefined, invite).then((req) =>
        solicitedBy(req, { ...noVouchRecord, writerDomains }, env)
      );

    expect(await asked(["mit.edu"])).toBe(true);
    expect(await asked(["mit.edu", "x.com"])).toBe(true);
    expect(await asked(["x.com"])).toBe(false);
    expect(await asked([])).toBe(false);

    // And the write itself still goes through: the terms decide the marker, never the permission.
    await expect(
      signedRequest(intent, undefined, undefined, invite).then((req) =>
        verifyPublicLeg(req, { ...noVouchRecord, writerDomains: [] }, env)
      )
    ).resolves.toBeUndefined();
  });

  it("still turns away the uninvited where a deployment asked for that", async () => {
    const intent = makeIntent({ domain: "~alice", handle: "bob", payload: toBytes32("hi") });
    const closed = { ...env, requireInvite: true };
    await expect(verifyPublicLeg(await signedRequest(intent), noVouchRecord, closed)).rejects.toThrow(
      "invite: ~alice needs the candidate's invitation"
    );
    await expect(
      verifyPublicLeg(
        await signedRequest(intent, undefined, undefined, await makeInvite()),
        noVouchRecord,
        closed
      )
    ).resolves.toBeUndefined();
  });

  it("a voucher who already holds a record there may update or withdraw it without a new invitation", async () => {
    const intent = makeIntent({
      domain: "~alice",
      handle: "bob",
      nonce: 2n,
      payload: toBytes32("withdrawn"),
    });
    const held = { ...noVouchRecord, exists: true, nonce: 1n, wallet: userAccount.address };
    // Where invitations are required, or this exemption is moot: with `requireInvite` off the check
    // returns on its first line and an already-held record has nothing to be excused from.
    const closed = { ...env, requireInvite: true };
    await expect(verifyPublicLeg(await signedRequest(intent), held, closed)).resolves.toBeUndefined();
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
    // Asserted where invitations are required, because that is the requirement being waived: an
    // organisation is vouched for once, and writing uninvited is what that buys.
    const closed = { ...env, requireInvite: true };
    await expect(verifyPublicLeg(await signedRequest(intent), asOrg, closed)).resolves.toBeUndefined();
    // A person with no invitation is not excused there, which is the difference the org record makes.
    await expect(
      verifyPublicLeg(await signedRequest(intent), { ...asOrg, issuerOrg: false }, closed)
    ).rejects.toThrow("needs the candidate's invitation");
    await expect(verifyPublicLeg(await signedRequest(intent), asOrg, env)).resolves.toBeUndefined();

    // And so does anyone else: a person writing for a handle nobody has claimed is the same act, and
    // the reference simply says nobody asked for it.
    const asPerson = { ...asOrg, issuerOrg: false };
    await expect(verifyPublicLeg(await signedRequest(intent), asPerson, env)).resolves.toBeUndefined();
    expect(await solicitedBy(await signedRequest(intent), asPerson, env)).toBe(false);
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

describe("a record lands in the DNS domain of its account", () => {
  const at = (domain: string) => ({ ...env, platformDomains: [domain] });

  it("takes the label, not the whole handle, when the domain is a DNS name", async () => {
    const res = await attest(
      await signedRequest(makeIntent({ domain: "example.com" })),
      noRecord,
      secrets,
      at("example.com")
    );
    expect(fromBytes32(res.record.name)).toBe("alice");
    expect(fromBytes32(res.record.domainName)).toBe("example.com");

    const onX = await attest(
      await signedRequest(makeIntent({ domain: "x.com" })),
      noRecord,
      secrets,
      at("x.com")
    );
    expect(fromBytes32(onX.record.name)).toBe("alice");
  });

  it("refuses an address issued by a different domain", async () => {
    await expect(
      attest(await signedRequest(makeIntent({ domain: "gmail.com" })), noRecord, secrets, at("gmail.com"))
    ).rejects.toThrow(/not an account at gmail.com/);
  });

  it("masks the address exactly, since nothing about it is published", async () => {
    const res = await attest(
      await signedRequest(makeIntent({ domain: "example.com", optIn: true })),
      noRecord,
      secrets,
      at("example.com")
    );
    const viewCode = deriveViewCode(secrets.viewcodeKey, "example.com", "alice@example.com");
    // Whoever is given the view code should read the address the platform issued, not a trimmed label.
    expect(decodeRecord(res.record, viewCode)).toEqual({
      handle: "alice@example.com",
      platformId: "alice@example.com",
    });
  });
});

describe("a handle that cannot be an ENS label", () => {
  it("is still attested, under the handle itself", async () => {
    // Discord writes `peersky#0` for an account with no discriminator. The record proves control
    // either way; only the name is lost, and refusing would be a dead end for an ordinary account.
    const linked = [
      { type: "wallet", address: userAccount.address, chain_type: "ethereum" },
      { type: "discord_oauth", subject: "77", username: "peersky#0" },
    ];
    const res = await attest(
      await signedRequest(makeIntent({ domain: "discord.com" }), mintIdToken(linked)),
      noRecord,
      secrets,
      { ...env, platformDomains: ["discord.com"] }
    );
    expect(fromBytes32(res.record.name)).toBe("peersky");

    const odd = [
      { type: "wallet", address: userAccount.address, chain_type: "ethereum" },
      { type: "discord_oauth", subject: "78", username: "a b" },
    ];
    const kept = await attest(
      await signedRequest(makeIntent({ domain: "discord.com" }), mintIdToken(odd)),
      noRecord,
      secrets,
      { ...env, platformDomains: ["discord.com"] }
    );
    expect(fromBytes32(kept.record.name)).toBe("a b");
  });
});

describe("a private account publishes nothing about itself", () => {
  it("masks the handle exactly as the platform writes it, discriminator included", async () => {
    // Opting in is the answer to "the chain must not say which account this is": the name on chain is
    // a one-time pad over the handle, so the handle's shape never mattered in the first place.
    const linked = [
      { type: "wallet", address: userAccount.address, chain_type: "ethereum" },
      { type: "discord_oauth", subject: "77", username: "peersky#0" },
    ];
    const res = await attest(
      await signedRequest(makeIntent({ domain: "discord.com", optIn: true }), mintIdToken(linked)),
      noRecord,
      secrets,
      { ...env, platformDomains: ["discord.com"] }
    );
    const viewCode = deriveViewCode(secrets.viewcodeKey, "discord.com", "77");
    expect(decodeRecord(res.record, viewCode)).toEqual({ handle: "peersky#0", platformId: "77" });
    // Nothing readable is published: the stored name is the pad, not the handle.
    expect(fromBytes32(res.record.name)).not.toContain("peersky");
    expect(res.record.payload).not.toBe(zeroHash);
  });

  it("falls back to the label when the handle is too long to be a name at all", async () => {
    // A Multipass name is 31 bytes. A longer address still gets a record; the view code opens the part
    // that fits, which is the label the namespace knows it by.
    const long = `${"a".repeat(40)}@example.com`;
    const linked = [
      { type: "wallet", address: userAccount.address, chain_type: "ethereum" },
      { type: "email", address: long },
    ];
    const res = await attest(
      await signedRequest(makeIntent({ domain: "example.com", optIn: true }), mintIdToken(linked)),
      noRecord,
      secrets,
      { ...env, platformDomains: ["example.com"] }
    );
    const viewCode = deriveViewCode(secrets.viewcodeKey, "example.com", long);
    // The local part is what fits, so that is what a view code opens.
    expect(decodeRecord(res.record, viewCode).handle).toBe("a".repeat(31));
  });
});
