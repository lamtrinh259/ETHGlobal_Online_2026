import { describe, expect, it } from "vitest";
import {
  ensNameFor,
  explainName,
  groupingFor,
  mountPath,
  PRIVATE_GROUPINGS,
  PUBLIC_GROUPINGS,
} from "../src/namespace.js";

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

describe("what a person may not be called", () => {
  it("keeps the grouping levels out of reach", async () => {
    const { RESERVED_HANDLES } = await import("../src/attest.js");
    // These four are mounted at the root, so a person taking one would collide with a whole namespace.
    for (const level of ["www", "@", "private-www", "private@"]) {
      expect(RESERVED_HANDLES).toContain(level);
    }
    // A platform is no longer a root label once it lives under `www`, but the flat deployments still hold.
    expect(RESERVED_HANDLES).toContain("x");
  });
});

describe("what a name claims", () => {
  const mounts = [
    { domain: "ketsuban", parentName: "ketsuban.eth" },
    {
      domain: "discord.com",
      parentName: "com.discord.www.ketsuban.eth",
      maskedParentName: "com.discord.private-www.ketsuban.eth",
    },
  ];
  const claim = (name: string) => explainName(name, mounts, ["ketsuban"]);

  it("tells the four shapes apart, from the mounts rather than from the shape alone", () => {
    expect(claim("slayer69.com.discord.www.ketsuban.eth")).toMatchObject({
      kind: "account",
      domain: "discord.com",
      label: "slayer69",
    });
    expect(claim("alice.com.discord.private-www.ketsuban.eth")).toMatchObject({
      kind: "private",
      label: "alice",
    });
    expect(claim("alice.ketsuban.eth")).toMatchObject({ kind: "person", label: "alice" });
    expect(claim("bob.alice.ketsuban.eth")).toMatchObject({ kind: "reference", label: "bob" });
  });

  it("says nothing it cannot support", () => {
    // A private name claims presence, not the account; an unknown name claims nothing at all.
    expect(claim("alice.com.discord.private-www.ketsuban.eth").says).toContain("behind a view code");
    expect(claim("alice.example.com").kind).toBe("unknown");
    expect(claim("a.b.c.ketsuban.eth").kind).toBe("unknown");
    expect(explainName("alice.ketsuban.eth", [], ["ketsuban"])).toEqual({ says: "", kind: "unknown" });
  });
});
