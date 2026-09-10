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
    // A claimed candidate has a vouch instance of their own, mounted under their name. It is a mount
    // like any other, so a classifier that reads the mounts sees it — and must not read it as a platform.
    { domain: "~alice", parentName: "alice.ketsuban.eth" },
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

  it("reads a reference as a reference even though the candidate's vouch instance is a mount", () => {
    // `~alice` is mounted at `alice.ketsuban.eth`, so `bob.alice.ketsuban.eth` is one label under a
    // mount — the shape of an account. It is not one: a vouch instance holds references, and calling
    // bob "an account at ~alice" both invents a platform and hides who the reference is about.
    const claimed = claim("bob.alice.ketsuban.eth");
    expect(claimed.kind).toBe("reference");
    expect(claimed.says).toContain("written for alice by bob");
    expect(claimed.says).not.toContain("~alice");
  });

  it("reads a mount as the place it is, not as a person who could never hold it", () => {
    // `x.ketsuban.eth` is where the `x` mount hangs its accounts, and `kju-is.ketsuban.eth` is a
    // subject instance. Both are one label under the root, which is also the shape of a person — so a
    // classifier that stops at the shape calls them people. Nobody can claim either: they are taken.
    expect(claim("ketsuban.eth")).toMatchObject({ kind: "mount" });
    expect(claim("alice.ketsuban.eth").kind).toBe("person");
    for (const level of ["www", "private-www", "@", "private@"]) {
      const level_claim = claim(`${level}.ketsuban.eth`);
      expect(level_claim.kind, level).toBe("mount");
      expect(level_claim.says, level).not.toContain("a person's name");
    }
  });

  it("says nothing it cannot support", () => {
    // A private name claims presence, not the account; an unknown name claims nothing at all.
    expect(claim("alice.com.discord.private-www.ketsuban.eth").says).toContain("behind a view code");
    expect(claim("alice.example.com").kind).toBe("unknown");
    expect(claim("a.b.c.ketsuban.eth").kind).toBe("unknown");
    expect(explainName("alice.ketsuban.eth", [], ["ketsuban"])).toEqual({ says: "", kind: "unknown" });
  });
});
