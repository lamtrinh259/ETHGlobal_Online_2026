import { describe, expect, it } from "vitest";
import type { WalletDashboard } from "@/lib/api";
import {
  claimProgress,
  isNameDomainFor,
  nameRows,
  needsAttention,
  returnTo,
  whatIsBack,
  parentNameFor,
  voucherProgress,
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
    {
      ...rec("~alice", "bob", "worked together"),
      kind: "reference" as const,
      candidate: "alice",
      ensName: "bob.alice.ketsuban.eth",
    },
    {
      ...rec("~carol", "bob", "expired", false),
      kind: "reference" as const,
      candidate: "carol",
      ensName: "bob.carol.ketsuban.eth",
    },
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
          kind: "reference" as const,
          candidate: "alice",
          ensName: null,
        },
        {
          ...rec("~carol", "bob", "w", false),
          validUntil: "2026-12-01T00:00:00.000Z",
          kind: "reference" as const,
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

describe("coming back from a detour", () => {
  /*
   * Linking an account is a one-time step on the dashboard, asked of somebody halfway through writing
   * a reference for a particular person. They were sent there with no way back: the page they left
   * said "come back here afterwards" and gave them nothing to come back with.
   */
  it("takes a path inside this app", () => {
    expect(returnTo("/vouch/alice")).toBe("/vouch/alice");
    expect(returnTo("/p/bob?links=x.com")).toBe("/p/bob?links=x.com");
  });

  it("refuses anywhere that is not inside this app", () => {
    // A return path comes off the query string, so it is whatever a link somebody was sent says.
    expect(returnTo("https://evil.example/steal")).toBeUndefined();
    expect(returnTo("//evil.example")).toBeUndefined();
    expect(returnTo("/\\evil.example")).toBeUndefined();
    expect(returnTo("javascript:alert(1)")).toBeUndefined();
    expect(returnTo("vouch/alice")).toBeUndefined();
    expect(returnTo(undefined)).toBeUndefined();
    expect(returnTo("")).toBeUndefined();
  });

  it("says what going back is for, in the words of the page it goes back to", () => {
    expect(whatIsBack("/vouch/alice")).toBe("referring alice");
    expect(whatIsBack("/p/bob")).toBe("bob’s page");
    expect(whatIsBack("/trust")).toBe("where you were");
  });
});
