import { describe, expect, it } from "vitest";
import {
  dnsNameFor,
  isDnsName,
  labelFor,
  pickAccountFor,
  platformOf,
  PLATFORM_DNS_NAMES,
} from "../src/accounts.js";
import { HANDLE_RE } from "../src/attest.js";

describe("a platform is a DNS name", () => {
  it("names the service rather than a bare word", () => {
    expect(PLATFORM_DNS_NAMES.x).toBe("x.com");
    expect(PLATFORM_DNS_NAMES.telegram).toBe("t.me");
    expect(dnsNameFor("github", {})).toBe("github.com");
    // Email has no fixed home: the address carries the domain it was issued by.
    expect(dnsNameFor("email", { username: "tim@peeramid.xyz" })).toBe("peeramid.xyz");
    expect(dnsNameFor("email", { username: "TIM@Peeramid.XYZ" })).toBe("peeramid.xyz");
  });

  it("refuses what cannot be a namespace", () => {
    expect(dnsNameFor("email", { username: "nobody" })).toBeUndefined();
    expect(dnsNameFor("email", { username: "a@localhost" })).toBeUndefined();
    expect(dnsNameFor("email", {})).toBeUndefined();
    expect(dnsNameFor("myspace", { username: "x" })).toBeUndefined();
    expect(isDnsName("x.com")).toBe(true);
    expect(isDnsName("a.b.c.co.uk")).toBe(true);
    expect(isDnsName("localhost")).toBe(false);
    expect(isDnsName("bad_label.com")).toBe(false);
  });

  it("takes the label from the handle, or an email's local part", () => {
    expect(labelFor("x", { username: "alice_x" })).toBe("alice_x");
    // A discriminator is not part of the handle: Discord writes `#0` for an account that has none.
    expect(labelFor("discord", { username: "peersky#0" })).toBe("peersky");
    expect(labelFor("discord", { username: "peersky#1234" })).toBe("peersky");
    expect(labelFor("email", { username: "tim@peeramid.xyz" })).toBe("tim");
    expect(labelFor("email", { username: "Tim.P@peeramid.xyz" })).toBeUndefined();
    expect(labelFor("x", { username: "has space" })).toBeUndefined();
    expect(labelFor("x", {})).toBeUndefined();
    expect(labelFor("email", {})).toBeUndefined();
  });
});

describe("a DNS domain says which platform it is", () => {
  it("reads a platform back from its own name", () => {
    expect(platformOf("x.com")).toBe("x");
    expect(platformOf("t.me")).toBe("telegram");
    expect(platformOf("google.com")).toBe("google");
    // A flat domain is still understood: the deployment that has them keeps working.
    expect(platformOf("x")).toBe("x");
    expect(platformOf("email")).toBe("email");
  });

  it("treats any other DNS name as an email domain", () => {
    // Nobody registers every mail host, so the domain of the address is the domain of the record.
    expect(platformOf("peeramid.xyz")).toBe("email");
    expect(platformOf("gmail.com")).toBe("email");
  });

  it("has no platform for what is neither", () => {
    expect(platformOf("myspace")).toBeUndefined();
    expect(platformOf("")).toBeUndefined();
  });

  it("picks the account a DNS domain asks for, and only from that domain", () => {
    const linked = [
      { type: "email", address: "tim@peeramid.xyz" },
      { type: "twitter_oauth", subject: "42", username: "alice_x" },
    ];
    expect(pickAccountFor(linked, "x.com")).toEqual({ subject: "42", username: "alice_x", label: "alice_x" });
    expect(pickAccountFor(linked, "peeramid.xyz")).toEqual({
      subject: "tim@peeramid.xyz",
      username: "tim@peeramid.xyz",
      label: "tim",
    });
    // An address issued elsewhere does not belong in this domain's namespace.
    expect(() => pickAccountFor(linked, "gmail.com")).toThrow(/gmail.com/);
    expect(() => pickAccountFor(linked, "myspace")).toThrow(/unknown/);
  });

  it("takes an address vouched for by Google as an address at its host", () => {
    // Signing in with Google links a `google_oauth` account, not an `email` one. The address is an
    // address either way; asking only for `email` answered a Gmail user with "no linked email account".
    const google = [{ type: "google_oauth", subject: "g1", email: "colors@gmail.com" }];
    expect(pickAccountFor(google, "gmail.com")).toEqual({
      subject: "g1",
      username: "colors@gmail.com",
      label: "colors",
    });
    expect(() => pickAccountFor(google, "peeramid.xyz")).toThrow(
      /colors@gmail.com is not an account at peeramid.xyz/
    );
    // With both linked, the one at the asked-for host is the one that counts.
    const both = [
      { type: "email", address: "tim@peeramid.xyz" },
      { type: "google_oauth", subject: "g1", email: "colors@gmail.com" },
    ];
    expect(pickAccountFor(both, "gmail.com").subject).toBe("g1");
    expect(pickAccountFor(both, "peeramid.xyz").subject).toBe("tim@peeramid.xyz");
    expect(() => pickAccountFor([], "gmail.com")).toThrow(/no linked address/);
  });

  it("keeps an account whose handle cannot be a label, without a label", () => {
    // The record still proves control; only the ENS name is lost, and refusing would be a dead end.
    const linked = [{ type: "twitter_oauth", subject: "42", username: "has space" }];
    expect(pickAccountFor(linked, "x.com")).toEqual({ subject: "42", username: "has space" });
    const discord = [{ type: "discord_oauth", subject: "7", username: "peersky#0" }];
    expect(pickAccountFor(discord, "discord.com")).toEqual({
      subject: "7",
      username: "peersky#0",
      label: "peersky",
    });
  });
});

/**
 * A Google account is an email account whose issuer vouches for it.
 *
 * Every one of them was mounted at `google.com`, which is a domain almost none of their holders have
 * an address at: signing in with Google gives `someone@gmail.com`, or a company's own domain under
 * Workspace. And the label took the whole address, which is not an ENS label at all — so the name a
 * Google account resolved at was either wrong about the domain or missing entirely.
 */
describe("a Google account is named by the address it is", () => {
  it("takes the domain of the address, not the name of the issuer", () => {
    expect(dnsNameFor("google", { username: "someone@gmail.com" })).toBe("gmail.com");
    expect(dnsNameFor("google", { username: "tim@peeramid.xyz" })).toBe("peeramid.xyz");
    expect(dnsNameFor("google", { username: "TIM@Peeramid.XYZ" })).toBe("peeramid.xyz");
  });

  it("falls back to the issuer only where there is no address to read", () => {
    expect(dnsNameFor("google", {})).toBe("google.com");
    expect(dnsNameFor("google", { username: "nobody" })).toBe("google.com");
  });

  it("takes the local part as the label, as an address always does", () => {
    expect(labelFor("google", { username: "someone@gmail.com" })).toBe("someone");
    expect(labelFor("google", { username: "tim@peeramid.xyz" })).toBe("tim");
  });
});

/**
 * One rule for what a handle may be.
 *
 * Every caller had written it out again — seven copies in the app, two in the attester — and one of
 * those said 30 rather than 31. A person holding a 31-character name could claim it and then have no
 * reference written for them: the instance those live in was refused before it was ever created.
 */
describe("what a handle may be", () => {
  it("takes a name as long as a left-aligned bytes32 holds", () => {
    expect(HANDLE_RE.test("a".repeat(31))).toBe(true);
    expect(HANDLE_RE.test("a".repeat(32))).toBe(false);
    expect(HANDLE_RE.test("")).toBe(false);
  });

  it("takes what a label may contain, and nothing else", () => {
    expect(HANDLE_RE.test("test-account-123456")).toBe(true);
    expect(HANDLE_RE.test("Not Valid")).toBe(false);
    expect(HANDLE_RE.test("under_score")).toBe(false);
    expect(HANDLE_RE.test("dot.ted")).toBe(false);
  });
});
