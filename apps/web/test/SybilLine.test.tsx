import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { Api, Graph, Readings } from "@/lib/api";

/**
 * One line under the name, from the same reads the cards below are drawn from. It has to say each
 * number's source in the same breath, and say plainly when there is nothing to measure.
 */
vi.mock("@/app/providers", () => ({
  useWebConfig: () => ({ apiUrl: "http://api.test", attestUrl: "http://api.test", instances: [] }),
}));
let current: Api;
vi.mock("@/lib/hooks", async (orig) => {
  const real = await orig<typeof import("@/lib/hooks")>();
  return { ...real, apiFor: () => current };
});

const graph: Graph = {
  handle: "alice",
  nodes: [],
  edges: [
    { from: "bob", to: "alice" },
    { from: "carol", to: "alice" },
  ],
  metrics: { mutual: 1, referrerDensity: 0.5, referrersReferringEachOther: 1, clusterSize: 3 },
  rank: 0.1875,
  human: true,
  seeds: 1,
  warning: "w",
};
const readings: Readings = {
  handle: "alice",
  council: true,
  model: "nsed:fast",
  received: [],
  given: [],
  summary: {
    received: { of: 2, read: 2, mean: 0.05, supportive: 1, critical: 1 },
    given: { of: 0, read: 0, mean: null, supportive: 0, critical: 0 },
  },
  warning: "w",
};

const show = async (g: () => Promise<Graph>, r: () => Promise<Readings>) => {
  current = { graph: vi.fn(g), readings: vi.fn(r) } as Partial<Api> as Api;
  const { SybilLine } = await import("@/app/SybilLine");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <SybilLine handle="alice" />
    </QueryClientProvider>
  );
};

describe("the sybil signal in one line", () => {
  it("says trust, who stands behind them, whether they know each other, and how the words read", async () => {
    await show(
      async () => graph,
      async () => readings
    );
    await waitFor(() => expect(screen.getByTestId("sybil-trust")).toHaveTextContent("0.188"));
    expect(screen.getByTestId("sybil-behind")).toHaveTextContent("2");
    expect(screen.getByTestId("sybil-among")).toHaveTextContent("1");
    expect(screen.getByTestId("sybil-human")).toHaveTextContent("proved human");
    expect(screen.getByTestId("sybil-read")).toHaveTextContent("reads 1 supportive / 1 critical");
  });

  it("says trust is unmeasured where nobody has proved humanity, and unread where no council reads", async () => {
    await show(
      async () => ({ ...graph, seeds: 0, rank: 0, human: false }),
      async () => ({ ...readings, council: false })
    );
    await waitFor(() => expect(screen.getByTestId("sybil-line")).toHaveTextContent("trust unmeasured"));
    expect(screen.getByTestId("sybil-human")).toHaveTextContent("humanity not proved");
    expect(screen.getByTestId("sybil-read")).toHaveTextContent("reads unread");
  });

  it("says nobody is behind them yet rather than counting to zero", async () => {
    await show(
      async () => ({ ...graph, edges: [] }),
      async () => readings
    );
    await waitFor(() => expect(screen.getByTestId("sybil-line")).toHaveTextContent("nobody behind them yet"));
    expect(screen.queryByTestId("sybil-behind")).toBeNull();
  });

  it("says the graph could not be read, rather than nothing", async () => {
    await show(
      async () => {
        throw new Error("down");
      },
      async () => readings
    );
    await waitFor(() => expect(screen.getByTestId("sybil-line")).toHaveTextContent("could not be read"));
  });
});
