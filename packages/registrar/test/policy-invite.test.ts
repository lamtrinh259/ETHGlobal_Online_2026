import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { inviteDomain } from "../src/invite.js";
import {
  policyInviteDomain,
  recoverPolicyInviteSigner,
  signPolicyInvite,
  type PolicyInvite,
} from "../src/policy-invite.js";

/**
 * An employer's invitation is their own claim, so the signature has to come back to their wallet and
 * to nothing else — not to a different bar, a different account, or the other kind of invitation.
 */
const employer = privateKeyToAccount("0x00000000000000000000000000000000000000000000000000000000000000e1");
const other = privateKeyToAccount("0x00000000000000000000000000000000000000000000000000000000000000e2");
const multipass = "0x000000000000000000000000000000000000dEaD";
const domain = policyInviteDomain(31337, multipass);
const invite: PolicyInvite = {
  inviter: "peersky",
  platform: "github.com",
  account: "lamtrinh259",
  policy: "policy=kju-is&min=2",
  exp: 1_900_000_000n,
};

describe("a policy invitation", () => {
  it("comes back to the wallet that signed it", async () => {
    const signature = await signPolicyInvite(employer, invite, domain);
    expect(await recoverPolicyInviteSigner(invite, signature, domain)).toBe(employer.address);
    expect(await recoverPolicyInviteSigner(invite, signature, domain)).not.toBe(other.address);
  });

  it("is a different invitation once the bar or the account changes", async () => {
    const signature = await signPolicyInvite(employer, invite, domain);
    const bar = await recoverPolicyInviteSigner({ ...invite, policy: "policy=any" }, signature, domain);
    const who = await recoverPolicyInviteSigner({ ...invite, account: "someone-else" }, signature, domain);
    expect(bar).not.toBe(employer.address);
    expect(who).not.toBe(employer.address);
  });

  it("cannot be replayed as the candidate's kind of invitation, or on another chain", async () => {
    const signature = await signPolicyInvite(employer, invite, domain);
    const asVouchInvite = await recoverPolicyInviteSigner(invite, signature, inviteDomain(31337, multipass));
    const elsewhere = await recoverPolicyInviteSigner(invite, signature, policyInviteDomain(1, multipass));
    expect(asVouchInvite).not.toBe(employer.address);
    expect(elsewhere).not.toBe(employer.address);
  });
});
