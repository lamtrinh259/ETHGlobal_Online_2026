import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { Api, Readings as ReadingsRead } from "@/lib/api";

/**
 * What the references say, in one line.
 *
 * The line has to be the sum of the readings behind the fold, every reading has to be marked for what
 * it is, and where no council read anything the page must say so rather than show a number.
 */
vi.mock("@/app/providers", () => ({
  useWebConfig: () => ({ apiUrl: "http://api.test", instances: [{ domain: "ketsuban" }] }),
}));

let current: Api;
vi.mock("@/lib/hooks", async (orig) => {
  const real = await orig<typeof import("@/lib/hooks")>();
  return { ...real, apiFor: () => current };
});

const reading = (polarity: number, rationale: string) => ({
  polarity,
  conviction: null,
  rationale,
  model: "nsed:fast",
  provisional: true as const,
});

const read: ReadingsRead = {
  handle: "alice",
  council: true,
  model: "nsed:fast",
  received: [
    { voucher: "bob", says: "would hire again", reading: reading(0.9, "an offer to work together again") },
    { voucher: "carol", says: "do not lend them money", reading: reading(-0.8, "a warning about money") },
    { voucher: "dan", says: "we met once", reading: null },
  ],
  given: [{ candidate: "bob", says: "steady under pressure", reading: reading(0.7, "praise for composure") }],
  summary: {
    received: { of: 3, read: 2, mean: 0.05, supportive: 1, critical: 1 },
    given: { of: 1, read: 1, mean: 0.7, supportive: 1, critical: 0 },
  },
  warning: "w",
};

const show = async (answer: () => Promise<ReadingsRead>) => {
  current = { readings: vi.fn(answer) } as Partial<Api> as Api;
  const { Readings } = await import("@/app/Readings");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <Readings handle="alice" />
    </QueryClientProvider>
  );
};

describe("what the references say", () => {
  it("sums the readings into one line, and marks it provisional by the council that read them", async () => {
    await show(async () => read);
    await waitFor(() =>
      expect(screen.getByTestId("readings-received")).toHaveTextContent("1 of 2 read as supportive")
    );
    expect(screen.getByTestId("readings-received")).toHaveTextContent("1 critical");
    expect(screen.getByTestId("readings-received")).toHaveTextContent("mean +0.05");
    expect(screen.getByTestId("readings-received")).toHaveTextContent("1 unread");
    expect(screen.getByTestId("readings")).toHaveTextContent("provisional");
    expect(screen.getByTestId("readings")).toHaveTextContent("nsed:fast");
  });

  it("keeps every reading behind the fold, each marked which way it leans, unread ones said so", async () => {
    await show(async () => read);
    await waitFor(() => expect(screen.getByTestId("readings-fold")).toBeInTheDocument());
    expect(screen.getByTestId("lean-bob")).toHaveTextContent("+0.90 supportive");
    expect(screen.getByTestId("lean-carol")).toHaveTextContent("-0.80 critical");
    expect(screen.getByTestId("lean-dan")).toHaveTextContent("unread");
    expect(screen.getByTestId("reading-bob")).toHaveTextContent("an offer to work together again");
    // What they wrote about others reads the same way, on its own line.
    expect(screen.getByTestId("readings-given")).toHaveTextContent("1 of 1 read as supportive");
    expect(screen.getByTestId("lean-given-bob")).toHaveTextContent("+0.70 supportive");
  });

  it("shows the statements as written, and says why, where no council reads them", async () => {
    const unread = {
      ...read,
      council: false,
      model: null,
      received: read.received.map((x) => ({ ...x, reading: null })),
      given: read.given.map((x) => ({ ...x, reading: null })),
      summary: {
        received: { of: 3, read: 0, mean: null, supportive: 0, critical: 0 },
        given: { of: 1, read: 0, mean: null, supportive: 0, critical: 0 },
      },
    };
    await show(async () => unread);
    await waitFor(() => expect(screen.getByTestId("readings-no-council")).toHaveTextContent("no council"));
    expect(screen.queryByTestId("readings-received")).toBeNull();
    expect(screen.getByTestId("reading-carol")).toHaveTextContent("do not lend them money");
    expect(screen.getByTestId("lean-carol")).toHaveTextContent("unread");
  });

  it("says there is nothing to read where nothing was written, rather than a line of zeros", async () => {
    await show(async () => ({
      ...read,
      received: [],
      given: [],
      summary: {
        received: { of: 0, read: 0, mean: null, supportive: 0, critical: 0 },
        given: { of: 0, read: 0, mean: null, supportive: 0, critical: 0 },
      },
    }));
    await waitFor(() => expect(screen.getByTestId("readings-empty")).toBeInTheDocument());
    expect(screen.queryByTestId("readings-fold")).toBeNull();
  });

  it("says the readings could not be fetched, rather than that there are none", async () => {
    await show(async () => {
      throw new Error("down");
    });
    await waitFor(() => expect(screen.getByTestId("readings-unread")).toBeInTheDocument());
    expect(screen.queryByTestId("readings-empty")).toBeNull();
  });
});
