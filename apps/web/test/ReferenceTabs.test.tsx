import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { Api, Readings, Vouch } from "@/lib/api";

/**
 * What the references say, in the list it says it about.
 *
 * The sum, the words, the reading and the reason for it were two renderings of one list — the tab, and
 * a card below it saying the same thing again. Merged, the tab has to carry all of it: the line at the
 * top, the reason under each statement, and, where no council reads anything, a sentence saying so
 * rather than a number nobody computed.
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

const read: Readings = {
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

const vouch = (voucher: string, statement: string): Vouch => ({
  voucher,
  voucherName: `${voucher}.ketsuban.eth`,
  ensName: `${voucher}.alice.ketsuban.eth`,
  wallet: "0x1",
  statement,
  validUntil: "2027-01-01T00:00:00.000Z",
  nonce: "1",
  live: true,
  solicited: true,
  invite: null,
});

const vouches = [
  vouch("bob", "would hire again"),
  vouch("carol", "do not lend them money"),
  vouch("dan", "we met once"),
];

const references = [
  {
    kind: "reference" as const,
    subject: "bob",
    subjectName: "bob.ketsuban.eth",
    statement: "steady under pressure",
    ensName: "alice.bob.ketsuban.eth",
    validUntil: "2027-01-01T00:00:00.000Z",
  },
];

const show = async (answer: () => Promise<Readings>) => {
  current = { readings: vi.fn(answer) } as Partial<Api> as Api;
  const { ReferenceTabs } = await import("@/app/ReferenceTabs");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ReferenceTabs handle="alice" vouches={vouches} references={references} />
    </QueryClientProvider>
  );
};

describe("the references tab", () => {
  it("sums the readings above the list, marked provisional by the council that read them", async () => {
    await show(async () => read);
    await waitFor(() =>
      expect(screen.getByTestId("readings-received")).toHaveTextContent("1 of 2 read as supportive")
    );
    const line = screen.getByTestId("readings-received");
    expect(line).toHaveTextContent("1 critical");
    expect(line).toHaveTextContent("mean +0.05");
    expect(line).toHaveTextContent("1 unread");
    expect(screen.getByLabelText("vouches received")).toHaveTextContent("provisional");
    expect(screen.getByLabelText("vouches received")).toHaveTextContent("nsed:fast");
  });

  it("says how each statement reads and why, under the words it was read from", async () => {
    await show(async () => read);
    await waitFor(() => expect(screen.getByTestId("lean-vouch-bob")).toHaveTextContent("+0.90 supportive"));
    expect(screen.getByTestId("lean-vouch-carol")).toHaveTextContent("-0.80 critical");
    expect(screen.getByTestId("lean-vouch-dan")).toHaveTextContent("unread");
    expect(screen.getByTestId("why-bob")).toHaveTextContent("an offer to work together again");
    // Nothing was read about dan, so nothing is said about why.
    expect(screen.queryByTestId("why-dan")).toBeNull();
    // And the caveat, once: it is a reading of text, not a judgement of a person.
    expect(screen.getByLabelText("vouches received")).toHaveTextContent("not a judgement of a person");
  });

  it("sums the other half on the tab that lists it, with the reason under each statement", async () => {
    await show(async () => read);
    await waitFor(() => expect(screen.getByTestId("readings-received")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("tab-given"));
    expect(screen.getByTestId("readings-given")).toHaveTextContent("1 of 1 read as supportive");
    expect(screen.getByTestId("why-given-bob")).toHaveTextContent("praise for composure");
  });

  it("shows the statements as written, and says why, where no council reads them", async () => {
    await show(async () => ({
      ...read,
      council: false,
      model: null,
      received: read.received.map((x) => ({ ...x, reading: null })),
      given: read.given.map((x) => ({ ...x, reading: null })),
    }));
    await waitFor(() => expect(screen.getByTestId("readings-no-council")).toHaveTextContent("no council"));
    expect(screen.queryByTestId("readings-received")).toBeNull();
    // The words are still the record, and no badge claims anybody read them.
    expect(screen.getByTestId("vouch-carol")).toHaveTextContent("do not lend them money");
    expect(screen.queryByTestId("lean-vouch-carol")).toBeNull();
  });

  it("says nothing about readings where they could not be fetched", async () => {
    await show(async () => {
      throw new Error("down");
    });
    await waitFor(() => expect(screen.getByTestId("vouches")).toBeInTheDocument());
    expect(screen.queryByTestId("readings-received")).toBeNull();
    expect(screen.queryByTestId("readings-no-council")).toBeNull();
  });
});
