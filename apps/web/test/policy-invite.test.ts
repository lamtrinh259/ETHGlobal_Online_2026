import { describe, expect, it } from "vitest";
import { policyInviteLink, policyInviteStatusText, policyInviteText } from "@/lib/policy-invite";

/**
 * The message names who is asking, for what, which account to begin with, and where to go — in that
 * order, because that is the order the person reading it needs the answers in.
 */
describe("what an employer sends", () => {
  it("says who invites, to pass which bar, which account to start from, and the link", () => {
    const link = policyInviteLink("https://ketsuban.peeramid.xyz/", "0123456789abcdef0123456789abcdef");
    // The same shape a vouch link has: the page, carrying the code.
    expect(link).toBe("https://ketsuban.peeramid.xyz/me?invite=0123456789abcdef0123456789abcdef");
    expect(
      policyInviteText("peersky.ketsuban.eth", "Backend engineer", "github.com", "lamtrinh259", link)
    ).toBe(
      "peersky.ketsuban.eth is inviting you to pass their Backend engineer risk assessment policy, please " +
        "follow this link and begin with connecting your github.com account (@lamtrinh259): " +
        "https://ketsuban.peeramid.xyz/me?invite=0123456789abcdef0123456789abcdef"
    );
  });

  it("says where the person is, pending until they have a page", () => {
    expect(policyInviteStatusText("invited", false)).toMatch(/^pending/);
    expect(policyInviteStatusText("linked", false)).toMatch(/^pending/);
    expect(policyInviteStatusText("claimed", false)).toBe("has a page");
    expect(policyInviteStatusText("invited", true)).toBe("expired, never came");
  });
});
