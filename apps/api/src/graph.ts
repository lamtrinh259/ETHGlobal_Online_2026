/**
 * The reference graph, read from what is on chain.
 *
 * A reference is a record in the candidate's own vouch domain — `~alice` holds one record per person
 * who referred alice, named for the referrer. Read every such domain and you have a directed graph:
 * an edge from whoever wrote the record to whoever the domain belongs to. Nothing here is inferred;
 * every edge is a signed record anybody can resolve.
 *
 * It exists because a count is not a shape. Three references from three strangers and three from a
 * ring of accounts that only refer each other are the same number, and the difference is the whole
 * of what a verifier wants to know. The graph is what makes that difference readable.
 */

/** As much of a chain record as the graph needs: whose domain, who wrote it, and whether it stands. */
export type ReferenceRecord = { domain: string; name: string; live: boolean };

export type GraphNode = {
  handle: string;
  /** References written for them that stand */
  received: number;
  /** References they have written that stand */
  given: number;
};

/** One reference: `from` put their name behind `to`. */
export type GraphEdge = { from: string; to: string };

export type ReferenceGraph = { nodes: GraphNode[]; edges: GraphEdge[] };

/**
 * Build the graph from every record in every vouch domain.
 *
 * Only live records are edges: a reference that lapsed or was withdrawn is history, not standing. A
 * person who appears only as a referrer is still a node — they are part of the shape even if nobody
 * has referred them.
 */
export function referenceGraph(records: ReferenceRecord[], vouchPrefix: string): ReferenceGraph {
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  for (const r of records) {
    if (!r.live || !r.domain.startsWith(vouchPrefix)) continue;
    const to = r.domain.slice(vouchPrefix.length).toLowerCase();
    const from = r.name.toLowerCase();
    // A person cannot stand behind themselves; a record shaped that way is noise, not an edge.
    if (!to || !from || to === from) continue;
    const key = `${from}>${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ from, to });
  }

  const nodes = new Map<string, GraphNode>();
  const node = (handle: string) => {
    let n = nodes.get(handle);
    if (!n) {
      n = { handle, received: 0, given: 0 };
      nodes.set(handle, n);
    }
    return n;
  };
  for (const e of edges) {
    node(e.from).given += 1;
    node(e.to).received += 1;
  }
  return {
    nodes: [...nodes.values()].sort((a, b) => b.received - a.received || a.handle.localeCompare(b.handle)),
    edges,
  };
}

/**
 * One person's neighbourhood: them, everyone who referred them, everyone they referred, and every
 * edge among that set — which is where "do their referrers refer each other" is answered.
 */
export function neighbourhood(graph: ReferenceGraph, handle: string): ReferenceGraph {
  const me = handle.toLowerCase();
  const near = new Set<string>([me]);
  for (const e of graph.edges) {
    if (e.to === me) near.add(e.from);
    if (e.from === me) near.add(e.to);
  }
  const edges = graph.edges.filter((e) => near.has(e.from) && near.has(e.to));
  const nodes = graph.nodes.filter((n) => near.has(n.handle));
  // Somebody with no references either way is still a person, and still the centre of their own map.
  if (!nodes.some((n) => n.handle === me)) nodes.push({ handle: me, received: 0, given: 0 });
  return { nodes, edges };
}

/**
 * What one person's part of the graph is shaped like.
 *
 * `received` says how many stand behind them; these say whether those people know each other. In an
 * honest network the people who vouch for somebody often know one another — colleagues, a team, a
 * cohort — and in a ring of bought accounts they know each other *perfectly*, because they are the
 * same operator. Both ends of that scale are the verifier's to read; the numbers only make the shape
 * visible.
 */
export type PersonMetrics = {
  /** Of the references they received, how many they also gave back: A refers B and B refers A. */
  mutual: number;
  /** Among their referrers, the share of possible referrer→referrer edges that exist (0..1). */
  referrerDensity: number;
  /** How many of their referrers refer at least one other of their referrers. */
  referrersReferringEachOther: number;
  /** How many people are reachable from them, edges taken either way. */
  clusterSize: number;
};

export function personMetrics(graph: ReferenceGraph, handle: string): PersonMetrics {
  const me = handle.toLowerCase();
  const referrers = graph.edges.filter((e) => e.to === me).map((e) => e.from);
  const gaveTo = new Set(graph.edges.filter((e) => e.from === me).map((e) => e.to));
  const mutual = referrers.filter((r) => gaveTo.has(r)).length;

  const set = new Set(referrers);
  const among = graph.edges.filter((e) => set.has(e.from) && set.has(e.to));
  const possible = referrers.length * (referrers.length - 1);
  const referrerDensity = possible === 0 ? 0 : among.length / possible;
  const referrersReferringEachOther = new Set(among.map((e) => e.from)).size;

  // Undirected reach: a reference either way is a connection either way.
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!adj.has(a)) adj.set(a, new Set());
    adj.get(a)!.add(b);
  };
  for (const e of graph.edges) {
    link(e.from, e.to);
    link(e.to, e.from);
  }
  const seen = new Set<string>([me]);
  const queue = [me];
  while (queue.length) {
    const at = queue.shift()!;
    for (const next of adj.get(at) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return { mutual, referrerDensity, referrersReferringEachOther, clusterSize: seen.size };
}

/**
 * A sybil rank, after SybilRank (Cao, Sirivianos, Yang, Pregueiro — NSDI 2012).
 *
 * Trust starts on seeds — here, whoever holds a live proof of humanity — and takes a short random
 * walk along references, edges taken either way. Each step every node hands its trust out equally
 * over its connections. After O(log n) steps, trust has spread through the honest region and has
 * barely crossed into a sybil region, because a ring of fake accounts is connected to the honest
 * graph by few edges however densely it is wired inside. Rank is trust per connection, so a
 * well-connected node is not rewarded for the connections alone.
 *
 * The result is a signal, not a verdict: a low rank says trust did not reach somebody, which is also
 * what a newcomer with one honest reference looks like. It is shown beside the count and the shape,
 * for a reader to weigh, and carries the same caveat as every other claim here.
 */
export function sybilRank(graph: ReferenceGraph, seeds: Iterable<string>): Map<string, number> {
  const handles = graph.nodes.map((n) => n.handle);
  if (handles.length === 0) return new Map();
  const adj = new Map<string, string[]>();
  for (const h of handles) adj.set(h, []);
  for (const e of graph.edges) {
    adj.get(e.from)!.push(e.to);
    adj.get(e.to)!.push(e.from);
  }
  const seedSet = new Set([...seeds].map((s) => s.toLowerCase()).filter((s) => adj.has(s)));
  // Nobody has proved anything: there is no honest region to spread from, so there is no rank.
  if (seedSet.size === 0) return new Map(handles.map((h) => [h, 0]));

  let trust = new Map(handles.map((h) => [h, seedSet.has(h) ? 1 / seedSet.size : 0]));
  const steps = Math.max(1, Math.ceil(Math.log2(handles.length)));
  for (let i = 0; i < steps; i++) {
    const next = new Map(handles.map((h) => [h, 0]));
    for (const h of handles) {
      const out = adj.get(h)!;
      const t = trust.get(h)!;
      if (out.length === 0) {
        // Nowhere to send it: it stays, rather than vanishing from the total.
        next.set(h, next.get(h)! + t);
        continue;
      }
      const share = t / out.length;
      for (const n of out) next.set(n, next.get(n)! + share);
    }
    trust = next;
  }
  return new Map(handles.map((h) => [h, trust.get(h)! / Math.max(1, adj.get(h)!.length)]));
}

/** How much proved humanity is worth on its own, and the most one reference can carry. */
export const SCORE_HUMAN = 20;
export const SCORE_PER_REFERENCE = 15;
export const SCORE_MAX = 100;

/**
 * SybilScore: what accumulates, from every connection, and starts near nothing.
 *
 * Rank above is trust per connection — a signal that tells a ring from a team, and one that a
 * newcomer with a single honest reference can score well on, which reads wrong on a page. This is the
 * other number a verifier asks for: how much is behind somebody, added up. Proved humanity is worth a
 * floor of its own; every live reference carries a share of its writer's score. Zero to a hundred,
 * whole numbers.
 *
 * Trust is conserved, after SybilRank and EigenTrust: a writer passes on at most one share of their
 * own score in total, split across everyone they vouch for, so a farm of a hundred accounts behind
 * one proved human holds together what one account would. Without that, SybilLimit's bound on attack
 * edges — the honest → sybil vouches an attacker has to earn — means nothing, because one edge feeds
 * any number of accounts. A vouch the council has read carries its reading as a weight (supportive
 * 1, critical 0); an unread one counts in full, never scored by something else.
 *
 * The walk stops after O(log n) hops, SybilRank's cut-off: trust fills the honest region and barely
 * crosses into a sybil one, which is joined to it by few edges however densely it is wired inside. A
 * ring of accounts nobody proved and nobody outside referred sums to nothing.
 */
export function sybilScore(
  graph: ReferenceGraph,
  humans: Iterable<string>,
  /** Weight per edge, keyed `from>to`, 0..1; absent means 1 */
  weights: ReadonlyMap<string, number> = new Map()
): Map<string, number> {
  const handles = graph.nodes.map((n) => n.handle);
  const human = new Set([...humans].map((h) => h.toLowerCase()));
  const weight = (e: GraphEdge) => Math.min(1, Math.max(0, weights.get(`${e.from}>${e.to}`) ?? 1));
  // What each writer hands out per edge: their one share, divided over the weight of all their
  // vouches — never less than one whole vouch, so a lone half-hearted one carries half, not all.
  const outWeight = new Map<string, number>(handles.map((h) => [h, 0]));
  for (const e of graph.edges) outWeight.set(e.from, outWeight.get(e.from)! + weight(e));
  const referrers = new Map<string, { from: string; part: number }[]>(handles.map((h) => [h, []]));
  for (const e of graph.edges) {
    const part = weight(e) / Math.max(1, outWeight.get(e.from)!);
    if (part > 0) referrers.get(e.to)?.push({ from: e.from, part });
  }
  let score = new Map(handles.map((h) => [h, human.has(h) ? SCORE_HUMAN : 0]));
  const hops = Math.max(2, Math.ceil(Math.log2(Math.max(2, handles.length))) + 1);
  for (let i = 0; i < hops; i++) {
    const next = new Map<string, number>();
    let moved = false;
    for (const h of handles) {
      const carried = referrers
        .get(h)!
        .reduce((sum, r) => sum + (score.get(r.from) ?? 0) * (SCORE_PER_REFERENCE / SCORE_MAX) * r.part, 0);
      const value = Math.min(SCORE_MAX, (human.has(h) ? SCORE_HUMAN : 0) + carried);
      if (Math.abs(value - score.get(h)!) > 1e-9) moved = true;
      next.set(h, value);
    }
    score = next;
    if (!moved) break;
  }
  return new Map(handles.map((h) => [h, Math.round(score.get(h)!)]));
}
