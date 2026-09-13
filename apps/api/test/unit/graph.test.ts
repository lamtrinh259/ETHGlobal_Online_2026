import { describe, expect, it } from "vitest";
import {
  neighbourhood,
  personMetrics,
  referenceGraph,
  sybilRank,
  SCORE_HUMAN,
  SCORE_MAX,
  sybilScore,
} from "../../src/graph.js";

/**
 * A count is not a shape.
 *
 * Three references from three strangers and three from a ring that only refers each other are the
 * same number. The graph is what makes them different, so it has to be built from exactly what is on
 * chain — every live record in a vouch domain is one edge — and from nothing else.
 */
const rec = (candidate: string, referrer: string, live = true) => ({
  domain: `~${candidate}`,
  name: referrer,
  live,
});

describe("the reference graph", () => {
  it("makes one edge per live reference, from whoever wrote it to whoever it is for", () => {
    const g = referenceGraph([rec("alice", "bob"), rec("alice", "carol"), rec("bob", "carol")], "~");
    expect(g.edges).toEqual([
      { from: "bob", to: "alice" },
      { from: "carol", to: "alice" },
      { from: "carol", to: "bob" },
    ]);
  });

  it("counts what each person received and gave, most referred first", () => {
    const g = referenceGraph([rec("alice", "bob"), rec("alice", "carol"), rec("bob", "carol")], "~");
    expect(g.nodes).toEqual([
      { handle: "alice", received: 2, given: 0 },
      { handle: "bob", received: 1, given: 1 },
      { handle: "carol", received: 0, given: 2 },
    ]);
  });

  it("leaves out what lapsed or was withdrawn: history is not standing", () => {
    const g = referenceGraph([rec("alice", "bob", false), rec("alice", "carol")], "~");
    expect(g.edges).toEqual([{ from: "carol", to: "alice" }]);
    expect(g.nodes.find((n) => n.handle === "bob")).toBeUndefined();
  });

  it("ignores records outside the vouch domains, and anybody vouching for themselves", () => {
    const g = referenceGraph(
      [
        { domain: "ketsuban", name: "alice", live: true },
        { domain: "x.com", name: "alice_x", live: true },
        rec("alice", "alice"),
        rec("alice", "bob"),
      ],
      "~"
    );
    expect(g.edges).toEqual([{ from: "bob", to: "alice" }]);
  });

  it("is one edge however many times the same reference is listed", () => {
    // The indexer keeps the latest state per record, but a renewal and its original can both appear.
    const g = referenceGraph([rec("alice", "bob"), rec("alice", "Bob")], "~");
    expect(g.edges).toHaveLength(1);
    expect(g.nodes.find((n) => n.handle === "alice")?.received).toBe(1);
  });

  it("is empty for a namespace with no references in it, rather than absent", () => {
    expect(referenceGraph([], "~")).toEqual({ nodes: [], edges: [] });
  });
});

describe("one person's neighbourhood", () => {
  /*
   * The question a verifier is asking: not how many referred them, but whether those referrers know
   * each other. That is answered by the edges among the referrers, which only a cut around the person
   * exposes.
   */
  const g = referenceGraph(
    [
      rec("alice", "bob"),
      rec("alice", "carol"),
      rec("bob", "carol"), // carol refers bob too: alice's referrers refer each other
      rec("dave", "erin"), // unrelated
      rec("bob", "alice"), // alice refers bob back
    ],
    "~"
  );

  it("holds the person, everyone either side of them, and every edge among that set", () => {
    const n = neighbourhood(g, "alice");
    expect(n.nodes.map((x) => x.handle).sort()).toEqual(["alice", "bob", "carol"]);
    expect(n.edges).toEqual([
      { from: "bob", to: "alice" },
      { from: "carol", to: "alice" },
      { from: "carol", to: "bob" },
      { from: "alice", to: "bob" },
    ]);
  });

  it("leaves out people two steps away", () => {
    const n = neighbourhood(g, "alice");
    expect(n.nodes.some((x) => x.handle === "dave" || x.handle === "erin")).toBe(false);
  });

  it("is still a map of one person when nobody has referred them", () => {
    const n = neighbourhood(g, "zed");
    expect(n).toEqual({ nodes: [{ handle: "zed", received: 0, given: 0 }], edges: [] });
  });

  it("reads the handle however it was written", () => {
    expect(neighbourhood(g, "ALICE").nodes.map((x) => x.handle)).toContain("alice");
  });
});

describe("the shape of one person's references", () => {
  const rec = (candidate: string, referrer: string) => ({
    domain: `~${candidate}`,
    name: referrer,
    live: true,
  });

  it("says how many referrers refer each other, and how dense that is", () => {
    // alice is referred by bob, carol and dan; bob and carol refer each other; dan knows nobody.
    const g = referenceGraph(
      [
        rec("alice", "bob"),
        rec("alice", "carol"),
        rec("alice", "dan"),
        rec("bob", "carol"),
        rec("carol", "bob"),
      ],
      "~"
    );
    const m = personMetrics(g, "alice");
    expect(m.referrersReferringEachOther).toBe(2);
    // Two of the six possible referrer→referrer edges exist.
    expect(m.referrerDensity).toBeCloseTo(2 / 6);
  });

  it("counts a reference returned as mutual", () => {
    const g = referenceGraph([rec("alice", "bob"), rec("bob", "alice"), rec("alice", "carol")], "~");
    expect(personMetrics(g, "alice").mutual).toBe(1);
  });

  it("measures the cluster with edges taken either way", () => {
    const g = referenceGraph([rec("alice", "bob"), rec("carol", "bob"), rec("dan", "erin")], "~");
    expect(personMetrics(g, "alice").clusterSize).toBe(3);
    expect(personMetrics(g, "dan").clusterSize).toBe(2);
  });

  it("is all zeros for somebody nobody has referred, rather than undefined", () => {
    const g = referenceGraph([rec("alice", "bob")], "~");
    expect(personMetrics(g, "zed")).toEqual({
      mutual: 0,
      referrerDensity: 0,
      referrersReferringEachOther: 0,
      clusterSize: 1,
    });
  });
});

describe("a sybil rank", () => {
  const rec = (candidate: string, referrer: string) => ({
    domain: `~${candidate}`,
    name: referrer,
    live: true,
  });
  /*
   * One honest cluster around a proved human, one ring wired only to itself, and a single edge from
   * the ring into the honest side — the shape SybilRank was built to tell apart.
   */
  const g = referenceGraph(
    [
      rec("alice", "bob"),
      rec("bob", "alice"),
      rec("carol", "alice"),
      rec("bob", "carol"),
      // the ring
      rec("s1", "s2"),
      rec("s2", "s3"),
      rec("s3", "s1"),
      rec("s1", "s3"),
      rec("s2", "s1"),
      rec("s3", "s2"),
      // its one bridge into the honest side
      rec("carol", "s1"),
    ],
    "~"
  );

  it("ranks the honest cluster above the ring, from one proved human", () => {
    const rank = sybilRank(g, ["alice"]);
    const honest = Math.min(rank.get("alice")!, rank.get("bob")!, rank.get("carol")!);
    const ring = Math.max(rank.get("s1")!, rank.get("s2")!, rank.get("s3")!);
    expect(honest).toBeGreaterThan(ring);
  });

  it("does not reward connections on their own: rank is trust per connection", () => {
    // s1 has the most connections of anybody and still ranks below every honest node.
    const rank = sybilRank(g, ["alice"]);
    expect(rank.get("s1")!).toBeLessThan(rank.get("carol")!);
  });

  it("is nothing where nobody has proved anything", () => {
    const rank = sybilRank(g, []);
    expect([...rank.values()].every((v) => v === 0)).toBe(true);
  });

  it("ignores a seed that is not in the graph rather than crashing on it", () => {
    expect(() => sybilRank(g, ["nobody-here", "ALICE"])).not.toThrow();
    expect(sybilRank(g, ["nobody-here", "ALICE"]).get("alice")!).toBeGreaterThan(0);
  });

  it("is empty for an empty graph", () => {
    expect(sybilRank({ nodes: [], edges: [] }, ["alice"]).size).toBe(0);
  });
});

describe("a sybil score", () => {
  /*
   * The number that accumulates. A newcomer starts near nothing; proved humanity is a floor; every
   * live reference adds a share of its writer's score; a ring nobody proved sums to nothing.
   */
  const rec = (candidate: string, referrer: string) => ({
    domain: `~${candidate}`,
    name: referrer,
    live: true,
  });

  it("is zero for somebody nobody has referred and nobody has proved", () => {
    const g = referenceGraph([rec("alice", "bob")], "~");
    expect(sybilScore(g, []).get("bob")).toBe(0);
    expect(sybilScore(g, []).get("alice")).toBe(0);
  });

  it("gives proved humanity a floor of its own", () => {
    const g = referenceGraph([rec("alice", "bob")], "~");
    expect(sybilScore(g, ["bob"]).get("bob")).toBe(SCORE_HUMAN);
  });

  it("carries a share of the writer's score along each reference, so who refers you is what counts", () => {
    const g = referenceGraph([rec("nadia", "mira"), rec("nadia", "nobody")], "~");
    const s = sybilScore(g, ["mira"]);
    // mira holds 20 (human); nadia gets 15% of that from mira and nothing from nobody.
    expect(s.get("mira")).toBe(20);
    expect(s.get("nadia")).toBe(3);
  });

  it("accumulates from every connection, and is capped at a hundred", () => {
    const humans = ["h1", "h2", "h3", "h4", "h5", "h6", "h7", "h8"];
    // Every proved human refers every other: each holds 20 + 7 × min(15, 15% of the other's score).
    const records = humans.flatMap((a) => humans.filter((b) => b !== a).map((b) => rec(a, b)));
    const s = sybilScore(referenceGraph(records, "~"), humans);
    for (const h of humans) expect(s.get(h)).toBeGreaterThan(SCORE_HUMAN);
    expect(Math.max(...humans.map((h) => s.get(h)!))).toBeLessThanOrEqual(SCORE_MAX);
    // Somebody all eight refer gets more than somebody one of them refers.
    const wide = sybilScore(
      referenceGraph([...records, ...humans.map((h) => rec("popular", h)), rec("lone", "h1")], "~"),
      humans
    );
    expect(wide.get("popular")!).toBeGreaterThan(wide.get("lone")!);
    // h1 stands behind nine people; the one vouch lone holds is a ninth of h1's share, which rounds away.
    expect(wide.get("lone")!).toBeLessThanOrEqual(1);
    expect(wide.get("popular")!).toBeGreaterThanOrEqual(3);
  });

  it("conserves trust: a writer's share is split across everyone they vouch for, so a farm gains nothing by size", () => {
    /*
     * SybilLimit's bound is on attack edges — honest → sybil vouches — and only holds when each one
     * costs the writer something. Copying the writer's share to every vouch let one proved human
     * hand a hundred fresh accounts the full share each; splitting it means the hundred together hold
     * what one would.
     */
    const one = sybilScore(referenceGraph([rec("s1", "mira")], "~"), ["mira"]);
    const farm = [...Array(100)].map((_, i) => `s${i + 1}`);
    const many = sybilScore(
      referenceGraph(
        farm.map((s) => rec(s, "mira")),
        "~"
      ),
      ["mira"]
    );
    const total = farm.reduce((sum, s) => sum + (many.get(s) ?? 0), 0);
    expect(one.get("s1")).toBe(3);
    expect(total).toBeLessThanOrEqual(one.get("s1")!);
    for (const s of farm) expect(many.get(s)!).toBeLessThan(one.get("s1")!);
  });

  it("weights a vouch by how it reads, where a council has read it", () => {
    // A vouch the council read as critical is not somebody standing behind you; an unread one counts in full.
    const g = referenceGraph([rec("nadia", "mira"), rec("nadia", "omar")], "~");
    const plain = sybilScore(g, ["mira", "omar"]);
    const weighed = sybilScore(g, ["mira", "omar"], new Map([["omar>nadia", 0]]));
    expect(plain.get("nadia")).toBe(6);
    expect(weighed.get("nadia")).toBe(3);
    const half = sybilScore(g, ["mira", "omar"], new Map([["omar>nadia", 0.5]]));
    expect(half.get("nadia")).toBe(5);
  });

  it("stops after a logarithmic number of hops, so trust does not creep deep into a sybil region", () => {
    // A long chain hung off one proved human: with the SybilRank cut-off the far end holds nothing.
    const chain = [...Array(64)].map((_, i) => `c${i}`);
    const records = chain.slice(1).map((c, i) => rec(c, chain[i]!));
    const s = sybilScore(referenceGraph([rec("c0", "mira"), ...records], "~"), ["mira"]);
    expect(s.get("c0")).toBe(3);
    expect(s.get("c63")).toBe(0);
  });

  it("sums a ring nobody proved to nothing, however tightly it is wired", () => {
    const ring = ["r1", "r2", "r3", "r4", "r5"];
    const records = ring.flatMap((a) => ring.filter((b) => b !== a).map((b) => rec(a, b)));
    const s = sybilScore(referenceGraph(records, "~"), []);
    for (const r of ring) expect(s.get(r)).toBe(0);
    // One bridge from a proved human lifts the one it reaches, and a little leaks around the ring.
    const bridged = sybilScore(referenceGraph([...records, rec("r1", "mira")], "~"), ["mira"]);
    expect(bridged.get("r1")!).toBeGreaterThan(0);
    expect(bridged.get("r1")!).toBeLessThan(SCORE_HUMAN);
  });
});
