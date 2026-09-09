import { describe, expect, it } from "vitest";
import {
  dnsNameFor,
  isDnsName,
  labelFor,
  pickAccountFor,
  platformOf,
  PLATFORM_DNS_NAMES,
} from "../src/accounts.js";

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

  it("refuses an account whose handle cannot be a label", () => {
    const linked = [{ type: "twitter_oauth", subject: "42", username: "has space" }];
    expect(() => pickAccountFor(linked, "x.com")).toThrow(/label/);
  });
});
