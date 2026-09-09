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
      { kind: "name", label: "bob.ketsuban.eth", daysLeft: 4, href: "/claim?renew=ketsuban" },
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
        href: "/claim?renew=ketsuban",
      },
      {
        domain: "kju-is",
        ensName: "bob.kju-is.ketsuban.eth",
        live: { payload: "terrible dictator", validUntil: "2027-01-01T00:00:00.000Z", nonce: "1" },
        expired: false,
        href: "/claim?renew=kju-is",
      },
      { domain: "uni", ensName: "bob.uni.ketsuban.eth", live: undefined, expired: true, href: "/claim" },
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
