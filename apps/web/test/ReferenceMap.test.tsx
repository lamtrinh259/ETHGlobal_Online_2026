import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { Api, Graph } from "@/lib/api";

/**
 * The shape behind the count.
 *
 * Three references from strangers and three from a ring that only refers itself are the same number.
 * The map is what tells them apart, so it has to draw exactly the edges the attester answered with,
 * say the numbers that describe the shape, and treat the rank as a signal rather than a verdict.
 */
vi.mock("@/app/providers", () => ({
  useWebConfig: () => ({ apiUrl: "http://api.test", instances: [{ domain: "ketsuban" }] }),
}));

const graph: Graph = {
  handle: "alice",
  nodes: [
    { handle: "alice", received: 2, given: 1, human: true, rank: 0.1875 },
    { handle: "bob", received: 2, given: 1, human: false, rank: 0.0625 },
    { handle: "carol", received: 1, given: 2, human: false, rank: 0.0417 },
  ],
  edges: [
    { from: "bob", to: "alice" },
    { from: "carol", to: "alice" },
    { from: "carol", to: "bob" },
    { from: "alice", to: "bob" },
  ],
  metrics: { mutual: 1, referrerDensity: 0.5, referrersReferringEachOther: 1, clusterSize: 3 },
  rank: 0.1875,
  human: true,
  seeds: 1,
  warning: "w",
};

const show = async (answer: () => Promise<Graph>) => {
  const api = { graph: vi.fn(answer) } as unknown as Api;
  const { ReferenceMap } = await import("@/app/ReferenceMap");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ReferenceMap handle="alice" />
    </QueryClientProvider>
  );
  return api;
};

vi.mock("@/lib/hooks", async (orig) => {
  const real = await orig<typeof import("@/lib/hooks")>();
  return { ...real, apiFor: () => current };
});
let current: Api;

describe("who stands behind somebody", () => {
  it("draws one line per reference and a mark per person, the centre among them", async () => {
    current = { graph: vi.fn(async () => graph) } as unknown as Api;
    await show(async () => graph);
    await waitFor(() => expect(screen.getByTestId("node-alice")).toBeInTheDocument());
    for (const e of graph.edges) expect(screen.getByTestId(`edge-${e.from}-${e.to}`)).toBeInTheDocument();
    expect(screen.getByTestId("node-bob")).toBeInTheDocument();
    expect(screen.getByTestId("node-carol")).toBeInTheDocument();
  });

  it("says the numbers that describe the shape, in terms of the referrers", async () => {
    current = { graph: vi.fn(async () => graph) } as unknown as Api;
    await show(async () => graph);
    await waitFor(() => expect(screen.getByTestId("fact-among")).toHaveTextContent("1 of 2"));
    expect(screen.getByTestId("fact-mutual")).toHaveTextContent("1 of 2");
    expect(screen.getByTestId("fact-cluster")).toHaveTextContent("3");
    expect(screen.getByTestId("fact-rank")).toHaveTextContent("0.188");
    expect(screen.getByTestId("fact-rank")).toHaveTextContent("one of them");
  });

  it("says trust has nowhere to start where nobody has proved humanity", async () => {
    current = { graph: vi.fn(async () => ({ ...graph, seeds: 0, rank: 0, human: false })) } as unknown as Api;
    await show(async () => ({ ...graph, seeds: 0, rank: 0, human: false }));
    await waitFor(() => expect(screen.getByTestId("fact-rank")).toHaveTextContent("nowhere to start"));
  });

  it("says there is no shape where nobody has referred them, rather than drawing an empty one", async () => {
    const alone = {
      ...graph,
      nodes: [graph.nodes[0]],
      edges: [],
      metrics: { ...graph.metrics, clusterSize: 1 },
    };
    current = { graph: vi.fn(async () => alone) } as unknown as Api;
    await show(async () => alone);
    await waitFor(() => expect(screen.getByTestId("reference-map-empty")).toBeInTheDocument());
    expect(screen.queryByTestId("reference-facts")).toBeNull();
  });

  it("says the graph could not be read, rather than that there is nothing in it", async () => {
    current = {
      graph: vi.fn(async () => {
        throw new Error("down");
      }),
    } as unknown as Api;
    await show(async () => {
      throw new Error("down");
    });
    await waitFor(() => expect(screen.getByTestId("reference-map-unread")).toBeInTheDocument());
    expect(screen.queryByTestId("reference-map-empty")).toBeNull();
  });
});
