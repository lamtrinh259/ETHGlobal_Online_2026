import { describe, expect, it } from "vitest";
import type { Verification, Vouch } from "@/lib/api";
import {
  assessProfile,
  DEFAULT_POLICY,
  policyFromQuery,
  displayableImage,
  normalUrl,
  profileNames,
  rootInstance,
  describePolicy,
  disclosureLink,
  lookupTarget,
  POLICY_PRESETS,
  policyToQuery,
  presetPolicy,
  policyAsked,
  shareSnippet,
  vouchRequest,
  type Policy,
} from "@/lib/profile";

const config = {
  instances: [
    { domain: "ketsuban", parentName: "ketsuban.eth", parentLabel: "ketsuban" },
    { domain: "kju-is", parentName: "kju-is.ketsuban.eth", parentLabel: "kju-is" },
  ],
};

const active = (name: string, over: Partial<Verification> = {}): Verification => ({
  name,
  instance: { domain: "ketsuban", parentName: "ketsuban.eth" },
  status: "active",
  wallet: "0xEE4811b9462956C9C3535E79c08776D769CA9F3a",
  answer: null,
  expiresAt: "2026-10-08T09:14:22.000Z",
  humanity: null,
  links: [],
  references: [],
  evidence: ["wallet_binding"],
  decision: "additional_context_available",
  warning: "w",
  ...over,
});

describe("profileNames", () => {
  it("lists the root name first, then one per subject instance", () => {
    expect(profileNames("alice", config)).toEqual(["alice.ketsuban.eth", "alice.kju-is.ketsuban.eth"]);
    expect(rootInstance(config).parentName).toBe("ketsuban.eth");
  });
});

describe("assessProfile", () => {
  it("grades a complete candidate against a verifier policy", () => {
    const p = assessProfile(
      "alice",
      [
        {
          instanceDomain: "ketsuban",
          name: "alice.ketsuban.eth",
          v: active("alice.ketsuban.eth", {
            links: [{ domain: "x", optedIn: true, commitment: "0x01" }],
            humanity: { level: "medium", until: null },
          }),
        },
        {
          instanceDomain: "kju-is",
          name: "alice.kju-is.ketsuban.eth",
          v: active("alice.kju-is.ketsuban.eth", { answer: "terrible dictator" }),
        },
      ],
      { requiredAnswers: ["kju-is"], minLinks: 1, requireHumanity: true, minVouches: 2 },
      [
        {
          voucher: "bob",
          voucherName: "bob.ketsuban.eth",
          wallet: "0x1",
          statement: "worked together",
          validUntil: "2027-01-01T00:00:00.000Z",
          nonce: "1",
          live: true,
          solicited: false,
          invite: null,
        },
        {
          voucher: "bob",
          voucherName: "bob.ketsuban.eth",
          wallet: "0x1",
          statement: "older",
          validUntil: "2026-01-01T00:00:00.000Z",
          nonce: "0",
          live: false,
          solicited: false,
          invite: null,
        },
        {
          voucher: "carol",
          voucherName: "carol.ketsuban.eth",
          wallet: "0x2",
          statement: "great",
          validUntil: "2027-01-01T00:00:00.000Z",
          nonce: "1",
          live: true,
          solicited: false,
          invite: null,
        },
      ]
    );
    expect(p.wallet).toBe("0xEE4811b9462956C9C3535E79c08776D769CA9F3a");
    expect(p.vouches).toHaveLength(3);
    expect(p.answers).toEqual([
      {
        domain: "kju-is",
        name: "alice.kju-is.ketsuban.eth",
        answer: "terrible dictator",
        status: "active",
        expiresAt: "2026-10-08T09:14:22.000Z",
      },
    ]);
    expect(p.checks.map((c) => [c.id, c.ok])).toEqual([
      ["identity", true],
      ["links", true],
      ["answer:kju-is", true],
      ["vouches", true],
      ["humanity", true],
    ]);
    expect(p.checks[1].detail).toBe("x (masked)");
    expect(p.checks[2].detail).toBe('"terrible dictator"');
    expect(p.checks[3].detail).toBe("2 live: bob, carol");
    expect(p.complete).toBe(true);
    expect(p.warning).toBe("w");
  });

  it("does not count a withdrawn statement as a reference", () => {
    const vouch = (voucher: string, statement: string) => ({
      voucher,
      voucherName: `${voucher}.ketsuban.eth`,
      wallet: "0x1",
      statement,
      validUntil: "2027-01-01T00:00:00.000Z",
      nonce: "2",
      live: true,
      solicited: false,
      invite: null,
    });
    const p = assessProfile(
      "alice",
      [{ instanceDomain: "ketsuban", name: "alice.ketsuban.eth", v: active("alice.ketsuban.eth") }],
      { requiredAnswers: [], minLinks: 0, requireHumanity: false, minVouches: 2 },
      [vouch("bob", "withdrawn"), vouch("carol", "worked together"), vouch("dave", "withdrawn")]
    );
    const check = p.checks.find((c) => c.id === "vouches")!;
    expect(check.ok).toBe(false);
    expect(check.detail).toBe("1 live: carol");
    // The records are still shown: nothing disappears, it just stops counting.
    expect(p.vouches).toHaveLength(3);
  });

  it("marks an unclaimed handle and missing answers as failing, with plain details", () => {
    const p = assessProfile(
      "nobody",
      [
        {
          instanceDomain: "ketsuban",
          name: "nobody.ketsuban.eth",
          v: { ...active("nobody.ketsuban.eth"), status: "inactive", wallet: null },
        },
        { instanceDomain: "kju-is", name: "nobody.kju-is.ketsuban.eth", v: null },
      ],
      { requiredAnswers: ["kju-is"], minLinks: 1, requireHumanity: false, minVouches: 3 }
    );
    expect(p.identity).toBeUndefined();
    expect(p.wallet).toBeNull();
    expect(p.checks.map((c) => c.ok)).toEqual([false, false, false, false]);
    expect(p.checks[0].detail).toContain("nobody.ketsuban.eth has no live record");
    expect(p.checks[1].detail).toBe("none");
    expect(p.checks[2].detail).toBe("no live answer");
    expect(p.checks[3].detail).toBe("none yet");
    expect(p.complete).toBe(false);
    expect(p.warning).toBe("w");
  });

  it("uses the default policy when none is given", () => {
    const p = assessProfile("a", [
      {
        instanceDomain: "ketsuban",
        name: "a.ketsuban.eth",
        v: active("a.ketsuban.eth", { links: [{ domain: "github", optedIn: false }] }),
      },
    ]);
    expect(DEFAULT_POLICY.minLinks).toBe(1);
    expect(DEFAULT_POLICY.minVouches).toBe(3);
    expect(p.checks.map((c) => c.id)).toEqual(["identity", "links", "vouches"]);
    expect(p.complete).toBe(false);
  });
});

describe("shareSnippet", () => {
  it("builds the cold-email line", () => {
    expect(shareSnippet("alice", "https://app.example/", "ketsuban.eth")).toBe(
      "Verify me at Ketsuban: https://app.example/p/alice — on-chain name alice.ketsuban.eth"
    );
  });
});

describe("vouchRequest", () => {
  it("builds the ask-for-a-reference message", () => {
    expect(vouchRequest("alice", "https://app.example/", "ketsuban.eth")).toBe(
      "Could you vouch for me? It takes five minutes and lands as your own permanent name: https://app.example/vouch/alice (my page: alice.ketsuban.eth)"
    );
  });
});

describe("lookupTarget", () => {
  it("sends a handle to the reference page and an address to the wallet page", () => {
    expect(lookupTarget("alice", "minLinks=1")).toEqual({ kind: "handle", href: "/p/alice?minLinks=1" });
    expect(lookupTarget(" Alice.ketsuban.eth ")).toEqual({ kind: "handle", href: "/p/alice" });
    expect(lookupTarget("alice.eth")).toEqual({ kind: "handle", href: "/p/alice" });
    expect(lookupTarget("0xEE4811b9462956C9C3535E79c08776D769CA9F3a")).toEqual({
      kind: "wallet",
      href: "/w/0xEE4811b9462956C9C3535E79c08776D769CA9F3a",
    });
    // A policy is meaningless for a wallet page: it shows what the wallet holds, ungraded.
    expect(lookupTarget("0xEE4811b9462956C9C3535E79c08776D769CA9F3a", "minLinks=1")?.href).toBe(
      "/w/0xEE4811b9462956C9C3535E79c08776D769CA9F3a"
    );
    expect(lookupTarget("")).toBeUndefined();
    expect(lookupTarget("Not A Handle")).toBeUndefined();
    expect(lookupTarget("0xnothex")).toBeUndefined();
  });
});

describe("policyFromQuery", () => {
  it("defaults to every subject and parses overrides", () => {
    expect(policyFromQuery({}, ["kju-is", "uni"])).toEqual({
      requiredAnswers: ["kju-is", "uni"],
      minLinks: 1,
      requireHumanity: false,
      // Anyone may refer anyone, so the default counts every live reference however it arrived.
      onlySolicited: false,
      minVouches: 3,
    });
    expect(
      policyFromQuery({ answers: "", minLinks: "3", humanity: "1", minVouches: "0" }, ["kju-is"])
    ).toEqual({
      requiredAnswers: [],
      minLinks: 3,
      requireHumanity: true,
      onlySolicited: false,
      minVouches: 0,
    });
    expect(policyFromQuery({ answers: "uni", minLinks: "x", minVouches: "y" }, ["kju-is"])).toEqual({
      requiredAnswers: ["uni"],
      onlySolicited: false,
      minLinks: 1,
      requireHumanity: false,
      minVouches: 3,
    });
  });
});

describe("disclosureLink", () => {
  it("points at the reference page with one platform and the view code", () => {
    expect(disclosureLink("https://app.example/", "alice", "x", "0xabc")).toBe(
      "https://app.example/p/alice?links=x&viewCode=0xabc"
    );
  });
});

describe("what a verifier is shown", () => {
  it("states each check as the question it checks, never the domain", () => {
    // The id keeps the domain, because that is what the query string and the code join on; the label is
    // the half a person reads, and "Answered kju-is" tells a hiring manager nothing.
    const { checks } = assessProfile(
      "alice",
      [
        { instanceDomain: "ketsuban", name: "alice.ketsuban.eth", v: null },
        { instanceDomain: "kju-is", name: "alice.kju-is.ketsuban.eth", v: null },
      ],
      { requiredAnswers: ["kju-is"], minLinks: 0, minVouches: 0, requireHumanity: false }
    );
    const answer = checks.find((c) => c.id === "answer:kju-is");
    expect(answer?.label).toBe("Answered What do you think of Kim Jong Un?");
  });
});

describe("policy presets", () => {
  it("expand to full policies, round-trip through the query string, and describe themselves", () => {
    const hiring = POLICY_PRESETS.find((p) => p.id === "hiring")!;
    const policy = presetPolicy(hiring, ["kju-is", "uni"]);
    expect(policy).toEqual({
      requiredAnswers: ["kju-is", "uni"],
      minLinks: 1,
      requireHumanity: false,
      // Anyone may refer anyone, so the default counts every live reference however it arrived.
      onlySolicited: false,
      minVouches: 3,
    });
    const q = policyToQuery(policy, "hiring");
    expect(q).toBe("answers=kju-is%2Cuni&minLinks=1&minVouches=3&preset=hiring");
    expect(policyFromQuery(Object.fromEntries(new URLSearchParams(q)), ["kju-is", "uni"])).toEqual(policy);

    const dao = presetPolicy(
      POLICY_PRESETS.find((p) => p.id === "dao")!,
      ["kju-is"]
    );
    expect(dao.requireHumanity).toBe(true);
    expect(policyToQuery(dao)).toBe("answers=kju-is&minLinks=0&minVouches=2&humanity=1");
    expect(policyFromQuery({ preset: "dao", minLinks: "9" }, ["kju-is"])).toEqual(dao);
    expect(policyFromQuery({ preset: "nope" }, ["kju-is"]).minLinks).toBe(1);

    // A policy is stated in questions, not in the domains they live in: the verifier setting it has
    // never heard of `kju-is`, and the query string keeps the domain either way.
    expect(describePolicy(dao)).toBe(
      "answers for What do you think of Kim Jong Un? · ≥0 linked accounts · ≥2 live references · humanity attested"
    );
    expect(
      describePolicy(
        presetPolicy(
          POLICY_PRESETS.find((p) => p.id === "landlord")!,
          ["kju-is"]
        )
      )
    ).toBe("no answers required · ≥1 linked account · ≥1 live reference");
  });
});

describe("a verifier who cares who asked", () => {
  const vouch = (voucher: string, solicited: boolean): Vouch => ({
    voucher,
    voucherName: `${voucher}.ketsuban.eth`,
    wallet: "0x1",
    statement: "worked together",
    validUntil: "2027-01-01T00:00:00.000Z",
    nonce: "1",
    live: true,
    solicited,
    invite: null,
  });
  const assess = (policy: Partial<Policy>, vouches: ReturnType<typeof vouch>[]) =>
    assessProfile(
      "alice",
      [{ instanceDomain: "ketsuban", name: "alice.ketsuban.eth", v: active("alice.ketsuban.eth") }],
      { requiredAnswers: [], minLinks: 0, requireHumanity: false, minVouches: 2, ...policy },
      vouches
    );

  it("asks who wrote it, not only how many did", () => {
    /*
     * A count says how many people spoke and never says who. A verifier who only cares about somebody
     * from one company had to read the list by eye. The pattern is the one a disclosure audience uses
     * — a name, or `*.branch` for anyone in it — rather than a second syntax to learn.
     */
    const acme = { ...vouch("dana", false), voucherName: "dana.acme.com" };
    const both = [vouch("bob", false), acme];

    const named = assess({ from: ["bob.ketsuban.eth"] }, both).checks.find((c) => c.id === "from");
    expect(named?.ok).toBe(true);
    expect(named?.detail).toContain("bob.ketsuban.eth");

    expect(assess({ from: ["*.acme.com"] }, both).checks.find((c) => c.id === "from")?.ok).toBe(true);
    // The branch itself is not a name under it, which is what the `*.` asks for.
    expect(
      assess({ from: ["*.acme.com"] }, [vouch("bob", false)]).checks.find((c) => c.id === "from")
    ).toMatchObject({ ok: false, detail: "nobody matching has written one" });

    // An unclaimed voucher has no name to match on, so their handle answers for them.
    const unclaimed = { ...vouch("erin", false), voucherName: null };
    expect(assess({ from: ["erin"] }, [unclaimed]).checks.find((c) => c.id === "from")?.ok).toBe(true);
  });

  it("says nothing about who wrote it when the policy did not ask", () => {
    expect(assess({}, [vouch("bob", false)]).checks.find((c) => c.id === "from")).toBeUndefined();
  });

  it("counts every live reference by default, however it arrived", () => {
    // Anyone may refer anyone, so the default policy must not quietly discount the unsolicited.
    const p = assess({}, [vouch("bob", false), vouch("carol", false)]);
    expect(p.checks.find((c) => c.id === "vouches")?.ok).toBe(true);
  });

  it("counts only the ones the candidate asked for when a verifier says so", () => {
    const strict = { onlySolicited: true };
    expect(
      assess(strict, [vouch("bob", false), vouch("carol", false)]).checks.find((c) => c.id === "vouches")?.ok
    ).toBe(false);
    expect(
      assess(strict, [vouch("bob", true), vouch("carol", true)]).checks.find((c) => c.id === "vouches")?.ok
    ).toBe(true);
    // Mixed: two live references, one of them unsolicited, is one reference by this policy.
    const mixed = assess(strict, [vouch("bob", true), vouch("carol", false)]);
    expect(mixed.checks.find((c) => c.id === "vouches")?.ok).toBe(false);
    expect(mixed.checks.find((c) => c.id === "vouches")?.detail).toMatch(/solicited/i);
  });

  it("carries the choice through the query string, so a policy is a link", () => {
    const policy = {
      requiredAnswers: [],
      minLinks: 0,
      requireHumanity: false,
      minVouches: 2,
      onlySolicited: true,
    };
    expect(policyToQuery(policy)).toContain("solicited=1");
    expect(policyFromQuery({ solicited: "1" }, []).onlySolicited).toBe(true);
    expect(policyFromQuery({}, []).onlySolicited).toBe(false);
  });
});

describe("the message a candidate sends with an invitation", () => {
  it("says which accounts the writer is asked to connect", async () => {
    // The requirement is enforced on chain either way; a message that omits it sends someone to a
    // page where their reference quietly comes out unsolicited.
    const { vouchRequest } = await import("@/lib/profile");
    const msg = vouchRequest("alice", "https://app.example", "ketsuban.eth", {
      code: "abcd1234",
      requires: ["linkedin.com", "mit.edu"],
    });
    expect(msg).toContain("linkedin.com");
    expect(msg).toContain("mit.edu");
    // The link is the invitation's own, not the bare page.
    expect(msg).toContain("/vouch/alice?invite=abcd1234");
  });

  it("asks plainly when nothing is required, without an empty list", async () => {
    const { vouchRequest } = await import("@/lib/profile");
    const msg = vouchRequest("alice", "https://app.example", "ketsuban.eth");
    expect(msg).toContain("/vouch/alice");
    expect(msg).not.toMatch(/connect|account/i);
  });
});

describe("a website somebody can actually follow", () => {
  it("gives a bare host the scheme a browser needs", () => {
    // How people write a website down. Left alone it is a path, not a site.
    expect(normalUrl("example.com")).toBe("https://example.com");
    expect(normalUrl("  peeramid.xyz/team  ")).toBe("https://peeramid.xyz/team");
  });

  it("leaves one that already says how to reach it", () => {
    expect(normalUrl("https://example.com")).toBe("https://example.com");
    // Including a scheme this app would not have picked: it is their record, not ours.
    expect(normalUrl("http://example.com")).toBe("http://example.com");
    expect(normalUrl("ipfs://bafy…")).toBe("ipfs://bafy…");
  });

  it("leaves something that is not a website yet, so it can be read back and fixed", () => {
    expect(normalUrl("")).toBe("");
    expect(normalUrl("coming soon")).toBe("coming soon");
  });
});

describe("a picture an https page is allowed to load", () => {
  it("upgrades one written before the attester knew its own scheme", () => {
    /*
     * Every avatar on the live deployment names `http://…`, because the URL was built from a request
     * that arrives as plain http behind a proxy. The record is permanent, so those cannot be fixed
     * where they are — but a browser was never going to make that request anyway.
     */
    expect(displayableImage("http://api.example/v1/avatar/a.png", true)).toBe(
      "https://api.example/v1/avatar/a.png"
    );
  });

  it("leaves it alone where the page itself is not secure, which is how local development runs", () => {
    expect(displayableImage("http://127.0.0.1:8787/v1/avatar/a.png", false)).toBe(
      "http://127.0.0.1:8787/v1/avatar/a.png"
    );
  });

  it("changes nothing else", () => {
    expect(displayableImage("https://api.example/a.png", true)).toBe("https://api.example/a.png");
    expect(displayableImage("ipfs://bafy", true)).toBe("ipfs://bafy");
    expect(displayableImage(null, true)).toBeNull();
    expect(displayableImage(undefined, true)).toBeNull();
  });
});

describe("policyAsked", () => {
  /*
   * A page that grades everybody against a bar nobody chose reads as a judgement of them. A verdict
   * is something a reader performs, so the page has to be able to tell that they did.
   */
  it("is false for a page opened with nothing on the query string", () => {
    expect(policyAsked({})).toBe(false);
    expect(policyAsked({ viewCode: "0x1", links: "x.com", reveal: "x.com" })).toBe(false);
    // An empty parameter is what a cleared form leaves behind, and asks for nothing.
    expect(policyAsked({ preset: "" })).toBe(false);
  });

  it("is true for every parameter a policy is carried in", () => {
    for (const k of ["preset", "answers", "minLinks", "minVouches", "humanity", "solicited", "from"])
      expect(policyAsked({ [k]: "1" }), k).toBe(true);
  });
});
