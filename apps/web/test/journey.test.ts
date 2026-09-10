import { describe, expect, it } from "vitest";
import type { WalletDashboard } from "@/lib/api";
import {
  claimProgress,
  isNameDomainFor,
  nameRows,
  needsAttention,
  parentNameFor,
  voucherProgress,
  vouchSteps,
} from "@/lib/journey";

const config = {
  nameDomains: ["ketsuban", "kju-is"],
  instances: [
    { domain: "ketsuban", parentName: "ketsuban.eth", parentLabel: "ketsuban" },
    { domain: "kju-is", parentName: "kju-is.ketsuban.eth", parentLabel: "kju-is" },
  ],
};

const rec = (domain: string, name: string, payload = "", live = true) => ({
  domain,
  name,
  payload,
  validUntil: "2027-01-01T00:00:00.000Z",
  nonce: "1",
  live,
});

const dash: WalletDashboard = {
  address: "0x1",
  names: [
    { ...rec("ketsuban", "bob"), ensName: "bob.ketsuban.eth" },
    { ...rec("kju-is", "bob", "terrible dictator"), ensName: "bob.kju-is.ketsuban.eth" },
    { ...rec("kju-is", "old", "x", false), ensName: "old.kju-is.ketsuban.eth" },
  ],
  links: [{ ...rec("x", "bob_x", "", false), optedIn: false }],
  given: [
    { ...rec("~alice", "bob", "worked together"), candidate: "alice", ensName: "bob.alice.ketsuban.eth" },
    { ...rec("~carol", "bob", "expired", false), candidate: "carol", ensName: "bob.carol.ketsuban.eth" },
  ],
  balance: "0",
  gasTopup: { enabled: false, amount: "0", available: false },
  warning: "w",
};

describe("domains", () => {
  it("treats configured and ~vouch domains as name domains, platforms as links", () => {
    expect(isNameDomainFor("ketsuban", config)).toBe(true);
    expect(isNameDomainFor("~alice", config)).toBe(true);
    expect(isNameDomainFor("x", config)).toBe(false);
  });

  it("nests vouch names under the candidate's root name", () => {
    expect(parentNameFor("kju-is", config)).toBe("kju-is.ketsuban.eth");
    expect(parentNameFor("~alice", config)).toBe("alice.ketsuban.eth");
    expect(parentNameFor("~", config)).toBeUndefined();
    expect(parentNameFor("x", config)).toBeUndefined();
    expect(parentNameFor("~alice", { instances: [] })).toBeUndefined();
  });
});

describe("voucherProgress", () => {
  it("resumes from live records only and finds the existing statement for the candidate", () => {
    expect(voucherProgress(dash, "ketsuban", "alice")).toEqual({
      linked: false,
      named: "bob",
      existing: {
        statement: "worked together",
        validUntil: "2027-01-01T00:00:00.000Z",
        nonce: "1",
        ensName: "bob.alice.ketsuban.eth",
      },
    });
    expect(voucherProgress(dash, "ketsuban", "carol").existing).toBeUndefined();
    expect(voucherProgress(dash, "ketsuban", "alice").org).toBeUndefined();
    expect(
      voucherProgress(
        { ...dash, org: { label: "acme-university", validUntil: "2027-01-01T00:00:00.000Z" } },
        "ketsuban",
        "alice"
      ).org
    ).toEqual({ label: "acme-university", validUntil: "2027-01-01T00:00:00.000Z" });
    expect(voucherProgress(undefined, "ketsuban", "alice")).toEqual({ linked: false });
  });
});

describe("claimProgress", () => {
  it("finds the live handle and the subjects already answered under it", () => {
    expect(claimProgress(dash, config.instances)).toEqual({ handle: "bob", answered: new Set(["kju-is"]) });
    expect(claimProgress(undefined, config.instances)).toEqual({ answered: new Set() });
    expect(claimProgress(dash, [])).toEqual({ answered: new Set() });
    const unanswered = { ...dash, names: [dash.names[0]] };
    expect(claimProgress(unanswered, config.instances)).toEqual({ handle: "bob", answered: new Set() });
  });
});

describe("needsAttention", () => {
  it("lists expired and soon-expiring records, soonest first, with a renewal target each", () => {
    const now = Date.parse("2026-12-28T00:00:00.000Z");
    const soonDash: WalletDashboard = {
      ...dash,
      names: [
        { ...rec("ketsuban", "bob"), ensName: "bob.ketsuban.eth" },
        {
          ...rec("kju-is", "bob", "x"),
          validUntil: "2027-03-01T00:00:00.000Z",
          ensName: "bob.kju-is.ketsuban.eth",
        },
      ],
      links: [{ ...rec("x", "bob_x", "", false), validUntil: "2026-12-20T00:00:00.000Z", optedIn: true }],
      given: [
        {
          ...rec("~alice", "bob", "w"),
          validUntil: "2026-12-31T00:00:00.000Z",
          candidate: "alice",
          ensName: null,
        },
        {
          ...rec("~carol", "bob", "w", false),
          validUntil: "2026-12-01T00:00:00.000Z",
          candidate: "carol",
          ensName: null,
        },
      ],
    };
    expect(needsAttention(soonDash, now)).toEqual([
      { kind: "link", label: "x link", daysLeft: -8, href: "/me#link" },
      { kind: "given", label: "reference for alice", daysLeft: 3, href: "/vouch/alice" },
      { kind: "name", label: "bob.ketsuban.eth", daysLeft: 4, href: "/me" },
    ]);
    expect(needsAttention(soonDash, now, 1)).toHaveLength(1);
    expect(needsAttention(undefined, now)).toEqual([]);
  });
});

describe("nameRows", () => {
  it("builds one row per instance under the held handle, distinguishing missing, live and expired", () => {
    const three = [
      ...config.instances,
      { domain: "uni", parentName: "uni.ketsuban.eth", parentLabel: "uni" },
    ];
    const withExpired: WalletDashboard = {
      ...dash,
      names: [...dash.names, { ...rec("uni", "bob", "cs", false), ensName: "bob.uni.ketsuban.eth" }],
    };
    expect(nameRows(withExpired, three)).toEqual([
      {
        domain: "ketsuban",
        ensName: "bob.ketsuban.eth",
        live: { payload: "", validUntil: "2027-01-01T00:00:00.000Z", nonce: "1" },
        expired: false,
        href: "/me",
      },
      {
        domain: "kju-is",
        ensName: "bob.kju-is.ketsuban.eth",
        live: { payload: "terrible dictator", validUntil: "2027-01-01T00:00:00.000Z", nonce: "1" },
        expired: false,
        href: "/me",
      },
      { domain: "uni", ensName: "bob.uni.ketsuban.eth", live: undefined, expired: true, href: "/me" },
    ]);
    expect(nameRows(undefined, three)).toEqual([]);
  });
});

describe("vouchSteps", () => {
  it("asks for three things: sign in, be one real person, write the reference", () => {
    const first = vouchSteps("alice", { authenticated: false, published: false });
    expect(first.map((s) => [s.id, s.state])).toEqual([
      ["signin", "now"],
      ["humanity", "pending"],
      ["write", "todo"],
    ]);
    expect(first.some((s) => s.id === "work" || s.id === "name")).toBe(false);
    expect(first[2].label).toBe("Write and sign the reference for alice");
    expect(first[0].detail).toContain("no seed phrase");
    expect(first[2].detail).toContain("never delete");

    expect(vouchSteps("alice", { authenticated: true, published: false }).map((s) => s.state)).toEqual([
      "done",
      "pending",
      "now",
    ]);
    expect(vouchSteps("alice", { authenticated: true, published: true }).map((s) => s.state)).toEqual([
      "done",
      "pending",
      "done",
    ]);
  });
});

describe("the voucher's humanity step", () => {
  it("says it is done once the voucher has proved it, rather than always pending", async () => {
    // It was hard-coded `pending` while nothing could prove it. Now that something can, a voucher who
    // has already proved it must not be shown an outstanding step they cannot clear.
    const { vouchSteps } = await import("@/lib/journey");
    const proved = vouchSteps("alice", { authenticated: true, published: false, human: true });
    expect(proved.find((s) => s.id === "humanity")?.state).toBe("done");
  });

  it("is still the next thing to do when it has not been proved", async () => {
    const { vouchSteps } = await import("@/lib/journey");
    const not = vouchSteps("alice", { authenticated: true, published: false, human: false });
    expect(not.find((s) => s.id === "humanity")?.state).toBe("now");
  });

  it("stays pending where the deployment cannot ask for it at all", async () => {
    // With World unconfigured there is nothing to click, and an outstanding step would be a dead end.
    const { vouchSteps } = await import("@/lib/journey");
    const off = vouchSteps("alice", { authenticated: true, published: false });
    expect(off.find((s) => s.id === "humanity")?.state).toBe("pending");
  });
});

describe("what the humanity step promises", () => {
  it("does not promise a guarantee the proof may not carry", async () => {
    // World's own docs disagree on whether a v4 nullifier is stable per person or one-time-use
    // (`idkit/integrate` says stable, `4-0-migration` says one-time). Uniqueness across accounts rests
    // on the first being true. Until that is settled, the step must not claim it: a promise the
    // system cannot keep is worse than a smaller one it can.
    const { vouchSteps } = await import("@/lib/journey");
    const step = vouchSteps("alice", { authenticated: true, published: false }).find(
      (s) => s.id === "humanity"
    )!;
    expect(step.detail).not.toMatch(/stops one person|cannot run|ten accounts|ten voucher/i);
    // What it can say is what the proof actually shows: a verified human, and no identity revealed.
    expect(step.detail).toMatch(/World ID/i);
    expect(step.detail).toMatch(/never see|without revealing/i);
  });
});
