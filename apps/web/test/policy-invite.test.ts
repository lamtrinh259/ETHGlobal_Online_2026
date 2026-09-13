import { describe, expect, it } from "vitest";
import { policyInviteLink, policyInviteStatusText, policyInviteText } from "@/lib/policy-invite";

/**
 * The message names who is asking, for what, which account to begin with, and where to go — in that
 * order, because that is the order the person reading it needs the answers in.
 */
describe("what an employer sends", () => {
  it("says who invites, to pass which bar, which account to start from, and the link", () => {
    const link = policyInviteLink("https://shibboleth.peeramid.xyz/", "0123456789abcdef0123456789abcdef");
    // The same shape a vouch link has: the page, carrying the code.
    expect(link).toBe("https://shibboleth.peeramid.xyz/me?invite=0123456789abcdef0123456789abcdef");
    expect(
      policyInviteText("peersky.ketsuban.eth", "Backend engineer", "github.com", "lamtrinh259", link)
    ).toBe(
      "peersky.ketsuban.eth is inviting you to pass their Backend engineer risk assessment policy, please " +
        "follow this link and begin with connecting your github.com account (@lamtrinh259): " +
        "https://shibboleth.peeramid.xyz/me?invite=0123456789abcdef0123456789abcdef"
    );
  });

  it("tells somebody who has a page to begin with it, rather than to connect an account", () => {
    expect(
      policyInviteText(
        "peersky.ketsuban.eth",
        "hiring",
        "ketsuban",
        "alice",
        "https://x/me?invite=c",
        "alice.ketsuban.eth"
      )
    ).toBe(
      "peersky.ketsuban.eth is inviting you to pass their hiring risk assessment policy, please follow this " +
        "link and begin with your page (alice.ketsuban.eth): https://x/me?invite=c"
    );
  });

  it("says where the person is, pending until they have a page", () => {
    expect(policyInviteStatusText("invited", false)).toMatch(/^pending/);
    expect(policyInviteStatusText("linked", false)).toMatch(/^pending/);
    expect(policyInviteStatusText("claimed", false)).toBe("has a page");
    expect(policyInviteStatusText("invited", true)).toBe("expired, never came");
  });
});
