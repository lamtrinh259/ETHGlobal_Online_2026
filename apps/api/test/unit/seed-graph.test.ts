import { describe, expect, it } from "vitest";
import { plan, walletFor } from "../../scripts/seed-graph.js";
import { personMetrics, referenceGraph, sybilRank } from "../../src/graph.js";

/**
 * The namespace the demo walks has to be shaped so the map has something to say — and the shape is
 * only worth seeding if the graph code actually tells its two halves apart. So the plan is checked
 * against the same functions the API answers with, before a single record is written.
 */
describe("the seeded namespace", () => {
  const p = plan();
  const g = referenceGraph(
    p.references.map((r) => ({ domain: `~${r.to}`, name: r.from, live: true })),
    "~"
  );
  const humans = p.people.filter((x) => x.human).map((x) => x.handle);

  it("says nothing longer than a record holds", () => {
    // A statement is the payload, and a payload is bytes32. One word too many and the seed dies
    // halfway through a namespace, which is exactly how it was found.
    for (const r of p.references)
      expect(new TextEncoder().encode(r.says).length, r.says).toBeLessThanOrEqual(31);
  });

  it("refers only to people it creates, and nobody to themselves", () => {
    const known = new Set(p.people.map((x) => x.handle));
    for (const r of p.references) {
      expect(known.has(r.from), r.from).toBe(true);
      expect(known.has(r.to), r.to).toBe(true);
      expect(r.from).not.toBe(r.to);
    }
  });

  it("seeds a few proved humans in the team, and none in the ring", () => {
    expect(humans.length).toBeGreaterThanOrEqual(2);
    expect(humans.every((h) => !h.startsWith("ring-"))).toBe(true);
  });

  it("wires the ring so that every member refers every other, and only one edge leaves it", () => {
    const ring = p.people.map((x) => x.handle).filter((h) => h.startsWith("ring-"));
    const inside = p.references.filter((r) => ring.includes(r.from) && ring.includes(r.to));
    expect(inside).toHaveLength(ring.length * (ring.length - 1));
    const leaving = p.references.filter((r) => ring.includes(r.from) && !ring.includes(r.to));
    expect(leaving).toHaveLength(1);
    expect(personMetrics(g, "ring-b").referrerDensity).toBe(1);
  });

  it("ranks the team above the ring, which is the whole point of seeding it", () => {
    const rank = sybilRank(g, humans);
    const team = ["mira", "theo", "sana", "kofi", "lena"].map((h) => rank.get(h)!);
    const ring = ["ring-a", "ring-b", "ring-c", "ring-d", "ring-e"].map((h) => rank.get(h)!);
    expect(Math.min(...team)).toBeGreaterThan(Math.max(...ring));
  });

  it("gives the newcomer one honest reference: trust reaches her, and her shape says nothing", () => {
    /*
     * The caveat, made concrete. Rank does its job — one reference from a proved human is enough for
     * trust to reach her and put her above the ring — but the shape around her is empty, which is
     * exactly what one bought reference would look like too. Shape and rank say different things.
     */
    const rank = sybilRank(g, humans);
    expect(personMetrics(g, "nadia")).toMatchObject({ referrersReferringEachOther: 0, mutual: 0 });
    for (const r of ["ring-a", "ring-b", "ring-c", "ring-d", "ring-e"])
      expect(rank.get("nadia")!, r).toBeGreaterThan(rank.get(r)!);
  });

  it("makes the team's referrers know each other, the way colleagues do", () => {
    const m = personMetrics(g, "mira");
    expect(m.referrersReferringEachOther).toBeGreaterThan(0);
    expect(m.referrerDensity).toBeGreaterThan(0);
    expect(m.referrerDensity).toBeLessThan(1);
  });
});

describe("the wallets it seeds with", () => {
  it("are the same wallet for the same handle and salt, and different otherwise", () => {
    expect(walletFor("mira", "demo").address).toBe(walletFor("mira", "demo").address);
    expect(walletFor("mira", "demo").address).not.toBe(walletFor("theo", "demo").address);
    expect(walletFor("mira", "demo").address).not.toBe(walletFor("mira", "other").address);
  });
});
