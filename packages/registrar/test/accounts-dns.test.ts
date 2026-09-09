import { describe, expect, it } from "vitest";
import { dnsNameFor, isDnsName, labelFor, PLATFORM_DNS_NAMES } from "../src/accounts.js";

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
    expect(labelFor("email", { username: "tim@peeramid.xyz" })).toBe("tim");
    expect(labelFor("email", { username: "Tim.P@peeramid.xyz" })).toBeUndefined();
    expect(labelFor("x", { username: "has space" })).toBeUndefined();
    expect(labelFor("x", {})).toBeUndefined();
  });
});
