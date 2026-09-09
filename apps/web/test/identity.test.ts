import { describe, expect, it } from "vitest";
import { domainFor, connectedAccounts, linkedDomains, whoAmI } from "@/lib/identity";

const WALLET = "0xD70B1f4b1cD2Cb2Dd6e4f0F5b0f7c1F2a3b494a0";

describe("whoAmI", () => {
  it("prefers a linked handle, then an address, then the wallet, and the Privy id last", () => {
    expect(whoAmI({ twitter: { username: "peersky" }, github: { username: "gh" } })).toEqual({
      label: "@peersky",
      source: "x",
    });
    expect(whoAmI({ github: { username: "gh" } })).toEqual({ label: "gh", source: "github" });
    expect(whoAmI({ telegram: { username: "tg" } })).toEqual({ label: "@tg", source: "telegram" });
    expect(whoAmI({ discord: { username: "dc#1" } })).toEqual({ label: "dc#1", source: "discord" });
    expect(whoAmI({ google: { email: "a@b.com" } })).toEqual({ label: "a@b.com", source: "google" });
    expect(whoAmI({ email: { address: "c@d.com" } })).toEqual({ label: "c@d.com", source: "email" });
    expect(whoAmI({ id: "did:privy:x" }, WALLET)).toEqual({ label: "0xD70B…94a0", source: "wallet" });
    expect(whoAmI({ id: "did:privy:x" })).toEqual({ label: "did:privy:x", source: "privy" });
    expect(whoAmI(null)).toEqual({ label: "signed in", source: "privy" });
    expect(whoAmI({ twitter: { username: null }, github: { username: "gh" } }).source).toBe("github");
  });
});

describe("linkedDomains", () => {
  it("lists the platform domains the user actually linked, in attester order", () => {
    expect(
      linkedDomains({ telegram: { username: "tg" }, twitter: { username: "x" }, email: { address: "e@f.g" } })
    ).toEqual(["x", "telegram", "email"]);
    expect(linkedDomains({ id: "did:privy:x" })).toEqual([]);
    expect(linkedDomains(undefined)).toEqual([]);
  });
});

describe("connectedAccounts", () => {
  it("labels each account the way its owner knows it, not by platform", () => {
    expect(
      connectedAccounts({
        twitter: { username: "peersky" },
        google: { email: "tim@peeramid.xyz" },
        github: { username: "peersky-gh" },
        telegram: { username: "tg" },
      })
    ).toEqual([
      { domain: "x", label: "@peersky" },
      { domain: "github", label: "peersky-gh" },
      { domain: "telegram", label: "@tg" },
      { domain: "google", label: "tim@peeramid.xyz" },
    ]);
    expect(connectedAccounts({ email: { address: "a@b.c" } })).toEqual([{ domain: "email", label: "a@b.c" }]);
    expect(connectedAccounts({ twitter: { username: null } })).toEqual([]);
    expect(connectedAccounts(undefined)).toEqual([]);
  });
});

const user = {
  twitter: { username: "alice_x" },
  email: { address: "tim@peeramid.xyz" },
};

describe("which domain an account is attested into", () => {
  const [x, mail] = connectedAccounts(user);

  it("uses the platform's own DNS name when the deployment has it", () => {
    expect(domainFor(x, ["x.com", "peeramid.xyz"])).toBe("x.com");
  });

  it("sends an email to the domain that issued it", () => {
    expect(domainFor(mail, ["x.com", "peeramid.xyz"])).toBe("peeramid.xyz");
    // A mail host nobody deployed has no namespace here, and saying so beats a revert after signing.
    expect(domainFor(mail, ["x.com"])).toBeUndefined();
  });

  it("still answers to a flat deployment", () => {
    expect(domainFor(x, ["x", "email"])).toBe("x");
    expect(domainFor(mail, ["x", "email"])).toBe("email");
  });

  it("prefers the DNS namespace when a deployment has both", () => {
    expect(domainFor(x, ["x", "x.com"])).toBe("x.com");
  });
});
