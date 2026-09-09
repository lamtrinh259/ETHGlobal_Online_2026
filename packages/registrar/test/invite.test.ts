import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import {
  candidateOf,
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
  const invite = { handle: "alice", voucher: ZERO_ADDRESS, exp: 1_800_000_000n } as const;

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
      signature: await signInvite(
        alice,
        { handle: "alice", voucher: bob.address, exp: 1_800_000_000n },
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
