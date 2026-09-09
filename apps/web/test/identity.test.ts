import { describe, expect, it } from "vitest";
import { linkedDomains, whoAmI } from "@/lib/identity";

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
