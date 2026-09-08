import { describe, expect, it } from "vitest";
import type { Verification } from "@/lib/api";
import {
  assessProfile,
  DEFAULT_POLICY,
  policyFromQuery,
  profileNames,
  rootInstance,
  describePolicy,
  disclosureLink,
  POLICY_PRESETS,
  policyToQuery,
  presetPolicy,
  shareSnippet,
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
        },
        {
          voucher: "bob",
          voucherName: "bob.ketsuban.eth",
          wallet: "0x1",
          statement: "older",
          validUntil: "2026-01-01T00:00:00.000Z",
          nonce: "0",
          live: false,
        },
        {
          voucher: "carol",
          voucherName: "carol.ketsuban.eth",
          wallet: "0x2",
          statement: "great",
          validUntil: "2027-01-01T00:00:00.000Z",
          nonce: "1",
          live: true,
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

describe("policyFromQuery", () => {
  it("defaults to every subject and parses overrides", () => {
    expect(policyFromQuery({}, ["kju-is", "uni"])).toEqual({
      requiredAnswers: ["kju-is", "uni"],
      minLinks: 1,
      requireHumanity: false,
      minVouches: 3,
    });
    expect(
      policyFromQuery({ answers: "", minLinks: "3", humanity: "1", minVouches: "0" }, ["kju-is"])
    ).toEqual({
      requiredAnswers: [],
      minLinks: 3,
      requireHumanity: true,
      minVouches: 0,
    });
    expect(policyFromQuery({ answers: "uni", minLinks: "x", minVouches: "y" }, ["kju-is"])).toEqual({
      requiredAnswers: ["uni"],
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

describe("policy presets", () => {
  it("expand to full policies, round-trip through the query string, and describe themselves", () => {
    const hiring = POLICY_PRESETS.find((p) => p.id === "hiring")!;
    const policy = presetPolicy(hiring, ["kju-is", "uni"]);
    expect(policy).toEqual({
      requiredAnswers: ["kju-is", "uni"],
      minLinks: 1,
      requireHumanity: false,
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

    expect(describePolicy(dao)).toBe(
      "answers for kju-is · ≥0 linked accounts · ≥2 live references · humanity attested"
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
