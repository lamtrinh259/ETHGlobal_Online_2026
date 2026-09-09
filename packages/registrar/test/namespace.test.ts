import { describe, expect, it } from "vitest";
import { ensNameFor, groupingFor, mountPath, PRIVATE_GROUPINGS, PUBLIC_GROUPINGS } from "../src/namespace.js";

const root = "ketsuban.eth";

describe("where an account's name lands", () => {
  it("mounts a DNS name first label first, so subdomains keep their own chain", () => {
    // `x.com` walks www → x → com. A tenant of acme.com walks its own chain and shares no level
    // with acme.com's own accounts.
    expect(mountPath("x.com", "www")).toEqual(["www", "x", "com"]);
    expect(mountPath("tenant.acme.com", "www")).toEqual(["www", "tenant", "acme", "com"]);
    expect(mountPath("peeramid.xyz", "@")).toEqual(["@", "peeramid", "xyz"]);
  });

  it("names a public account after the account", () => {
    expect(ensNameFor({ root, domain: "x", dns: "x.com", label: "alice_x", optIn: false })).toBe(
      "alice_x.com.x.www.ketsuban.eth"
    );
    expect(ensNameFor({ root, domain: "email", dns: "peeramid.xyz", label: "tim", optIn: false })).toBe(
      "tim.xyz.peeramid.@.ketsuban.eth"
    );
  });

  it("names a masked account after the person holding it", () => {
    // The stored name is a one-time pad over the handle, so it is the holder who is named.
    expect(ensNameFor({ root, domain: "x", dns: "x.com", label: "alice", optIn: true })).toBe(
      "alice.com.x.private-www.ketsuban.eth"
    );
    expect(ensNameFor({ root, domain: "email", dns: "peeramid.xyz", label: "alice", optIn: true })).toBe(
      "alice.xyz.peeramid.private@.ketsuban.eth"
    );
  });

  it("has nothing to say without a DNS name or a label", () => {
    expect(ensNameFor({ root, domain: "x", dns: undefined, label: "alice", optIn: false })).toBeUndefined();
    expect(ensNameFor({ root, domain: "x", dns: "x.com", label: undefined, optIn: false })).toBeUndefined();
    expect(ensNameFor({ root, domain: "x", dns: "localhost", label: "alice", optIn: false })).toBeUndefined();
  });

  it("groups email apart from the rest, because an address is not a handle", () => {
    expect(groupingFor("email")).toEqual({ open: "@", masked: "private@" });
    expect(groupingFor("x")).toEqual({ open: "www", masked: "private-www" });
    expect(PUBLIC_GROUPINGS).toEqual(["www", "@"]);
    expect(PRIVATE_GROUPINGS).toEqual(["private-www", "private@"]);
  });
});
