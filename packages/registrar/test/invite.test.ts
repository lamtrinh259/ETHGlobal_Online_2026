import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import {
  candidateOf,
  meetsInvite,
  decodeInvite,
  encodeInvite,
  inviteDomain,
  recoverInviteSigner,
  signInvite,
  ZERO_ADDRESS,
} from "../src/invite.js";
import { intentDomain } from "../src/intent.js";

const MULTIPASS = "0x418F82fd0014a4CA402F145978bfaF0555a9cA06";
const alice = privateKeyToAccount("0x000000000000000000000000000000000000000000000000000000000000a11c");
const bob = privateKeyToAccount("0x000000000000000000000000000000000000000000000000000000000000b0bb");

describe("invite signatures", () => {
  const invite = { handle: "alice", voucher: ZERO_ADDRESS, exp: 1_800_000_000n, requires: [] } as const;

  it("recovers the candidate who signed it", async () => {
    const signature = await signInvite(alice, invite, inviteDomain(11155111, MULTIPASS));
    expect(await recoverInviteSigner(invite, signature, inviteDomain(11155111, MULTIPASS))).toBe(
      alice.address
    );
    expect(await recoverInviteSigner(invite, signature, inviteDomain(1, MULTIPASS))).not.toBe(alice.address);
  });

  it("cannot be replayed as an intent, and an intent cannot be replayed as an invite", async () => {
    const asInvite = await signInvite(alice, invite, inviteDomain(11155111, MULTIPASS));
    expect(await recoverInviteSigner(invite, asInvite, intentDomain(11155111, MULTIPASS))).not.toBe(
      alice.address
    );
  });

  it("binds a named voucher", async () => {
    const one = { ...invite, voucher: bob.address };
    const signature = await signInvite(alice, one, inviteDomain(11155111, MULTIPASS));
    expect(await recoverInviteSigner(one, signature, inviteDomain(11155111, MULTIPASS))).toBe(alice.address);
    expect(
      await recoverInviteSigner(
        { ...one, voucher: ZERO_ADDRESS },
        signature,
        inviteDomain(11155111, MULTIPASS)
      )
    ).not.toBe(alice.address);
  });
});

describe("invite transport", () => {
  it("round-trips through a URL-safe token", async () => {
    const invite = {
      handle: "alice",
      voucher: bob.address,
      exp: 1_800_000_000n,
      requires: [],
      signature: await signInvite(
        alice,
        { handle: "alice", voucher: bob.address, exp: 1_800_000_000n, requires: [] },
        inviteDomain(11155111, MULTIPASS)
      ),
    };
    const token = encodeInvite(invite);
    expect(token).not.toMatch(/[+/=]/);
    expect(decodeInvite(token)).toEqual(invite);
  });

  it("rejects a malformed token", () => {
    expect(() =>
      decodeInvite(
        encodeInvite({ handle: "a", voucher: ZERO_ADDRESS, exp: 1n, signature: "0x" } as never).slice(4)
      )
    ).toThrow();
    expect(() => decodeInvite(btoa(JSON.stringify({ handle: 1, exp: "1" })))).toThrow(/malformed/);
  });
});

describe("candidateOf", () => {
  it("reads the candidate out of a vouch domain", () => {
    expect(candidateOf("~alice", ["~"])).toBe("alice");
    expect(candidateOf("kju-is", ["~"])).toBeUndefined();
    expect(candidateOf("~", ["~"])).toBeUndefined();
  });
});

describe("an invitation that asks something of the writer", () => {
  const base = { handle: "alice", voucher: ZERO_ADDRESS, exp: 1_800_000_000n, requires: [] as string[] };
  const domain = inviteDomain(11155111, MULTIPASS);

  it("carries the accounts the candidate wants seen, and signs over them", async () => {
    // "Only from someone with a university address" is a real thing to ask for, and it only means
    // anything if the requirement is part of what was signed.
    const asked = { ...base, requires: ["linkedin.com", "mit.edu"] };
    const signature = await signInvite(alice, asked, domain);
    expect(await recoverInviteSigner(asked, signature, domain)).toBe(alice.address);

    // Dropping or adding a requirement is a different invitation, not the same one relaxed.
    expect(await recoverInviteSigner({ ...asked, requires: ["linkedin.com"] }, signature, domain)).not.toBe(
      alice.address
    );
    expect(await recoverInviteSigner(base, signature, domain)).not.toBe(alice.address);
  });

  it("is met only by a writer who holds every account it names", () => {
    const asked = { ...base, requires: ["linkedin.com", "mit.edu"] };
    expect(meetsInvite(asked, ["linkedin.com", "mit.edu", "x.com"])).toBe(true);
    expect(meetsInvite(asked, ["linkedin.com"])).toBe(false);
    expect(meetsInvite(asked, [])).toBe(false);
    // An invitation that asks for nothing is met by anyone, which is the common case.
    expect(meetsInvite(base, [])).toBe(true);
  });

  it("compares domains as domains, not as text", () => {
    const asked = { ...base, requires: ["MIT.edu"] };
    expect(meetsInvite(asked, ["mit.edu"])).toBe(true);
    // A neighbouring domain is a different institution: matching on suffix would let anyone in.
    expect(meetsInvite(asked, ["notmit.edu"])).toBe(false);
  });
});
