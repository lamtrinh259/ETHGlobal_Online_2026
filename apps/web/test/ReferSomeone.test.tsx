import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Api } from "@/lib/api";

vi.mock("@/app/providers", () => ({
  useWebConfig: () => ({
    apiUrl: "http://api.test",
    attestUrl: "http://api.test",
    instances: [{ domain: "ketsuban", parentName: "ketsuban.eth", parentLabel: "ketsuban" }],
  }),
}));

const state = {
  matches: [] as { handle: string; claimed: boolean; given: number; received: number }[],
  who: { found: false } as Record<string, unknown>,
  askedWith: undefined as string | undefined,
};
const api = {
  find: vi.fn(async (q: string) => ({ q, matches: state.matches })),
  who: vi.fn(async (domain: string, handle: string, viewCode?: string) => {
    state.askedWith = viewCode;
    return { domain, handle, ...state.who };
  }),
} as unknown as Api;

const { ReferSomeone } = await import("@/app/me/ReferSomeone");
const { POPULAR_ASKS, askById } = await import("@/lib/asks");

const wrapper = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
};
/** Every path starts behind the CTA now, so the tests open it the way a person would. */
const refer = (onGo = vi.fn()) => {
  render(<ReferSomeone api={api} onGo={onGo} />, { wrapper: wrapper() });
  fireEvent.click(screen.getByTestId("refer-open"));
  return onGo;
};

describe("referring someone by their account", () => {
  beforeEach(() => {
    state.matches = [];
    state.who = { found: false };
  });

  it("looks the account up on the platform it belongs to", async () => {
    state.who = { found: true, candidate: "bobby", standing: { claimed: true, given: 0, received: 4 } };
    refer();
    fireEvent.change(screen.getByTestId("account-handle"), { target: { value: "@bob" } });
    await waitFor(() => expect(screen.getByTestId("who-result")).toHaveTextContent("bobby"));
    // The evidence that this is the right person travels with the answer.
    expect(screen.getByTestId("who-result")).toHaveTextContent("4");
  });

  it("finds a private account when the searcher was given its view code", async () => {
    // The code is the permission: nothing else can find a masked record, and the candidate chose to
    // hand it over. Offering the field is what makes a private account referable at all.
    const code = `0x${"5a".repeat(32)}`;
    state.who = { found: true, candidate: "bobby", standing: { claimed: true, given: 0, received: 2 } };
    refer();
    fireEvent.change(screen.getByTestId("account-handle"), { target: { value: "bob" } });
    fireEvent.click(screen.getByTestId("have-viewcode"));
    fireEvent.change(screen.getByTestId("viewcode"), { target: { value: code } });
    await waitFor(() => expect(state.askedWith).toBe(code));
    await waitFor(() => expect(screen.getByTestId("who-result")).toHaveTextContent("bobby"));
  });

  it("says a private account cannot be searched, instead of offering to start a second page", async () => {
    // Writing a new page for someone who already has one is the failure this warning prevents.
    state.who = { found: false, note: "a private account cannot be searched — ask them for their page" };
    refer();
    fireEvent.change(screen.getByTestId("account-handle"), { target: { value: "bob" } });
    await waitFor(() => expect(screen.getByTestId("who-result")).toHaveTextContent(/private account/i));
  });
});

describe("referring someone by name", () => {
  beforeEach(() => {
    state.matches = [];
    state.who = { found: false };
  });

  it("shows every bob with the references each has, most first, and lets you pick", async () => {
    // Nothing decides which `bob` is meant; the one people have vouched for is the evidence.
    state.matches = [
      { handle: "bobby", claimed: true, given: 1, received: 3 },
      { handle: "bob", claimed: true, given: 0, received: 1 },
    ];
    const go = refer();
    fireEvent.click(screen.getByTestId("by-name"));
    fireEvent.change(screen.getByTestId("name-query"), { target: { value: "bob" } });

    await waitFor(() => expect(screen.getByTestId("match-bobby")).toBeInTheDocument());
    expect(screen.getByTestId("match-bobby")).toHaveTextContent("3");
    fireEvent.click(screen.getByTestId("pick-bobby"));
    expect(go).toHaveBeenCalledWith("bobby", undefined);
  });

  it("offers a new page only once the search has answered, so nobody splits a person in two", async () => {
    state.matches = [{ handle: "bob", claimed: true, given: 0, received: 2 }];
    const go = refer();
    fireEvent.click(screen.getByTestId("by-name"));
    fireEvent.change(screen.getByTestId("name-query"), { target: { value: "bob" } });
    await waitFor(() => expect(screen.getByTestId("match-bob")).toBeInTheDocument());

    // Still possible — two people really can share a name — but after seeing who is already here.
    fireEvent.click(screen.getByTestId("refer-new"));
    expect(go).toHaveBeenCalledWith("bob", undefined);
  });

  it("keeps the whole picker behind one CTA, so the step is an invitation rather than a form", () => {
    render(<ReferSomeone api={api} onGo={vi.fn()} />, { wrapper: wrapper() });
    // Nothing to fill in until someone says they want to refer a person.
    expect(screen.queryByTestId("by-account")).toBeNull();
    expect(screen.queryByTestId("account-handle")).toBeNull();

    fireEvent.click(screen.getByTestId("refer-open"));
    expect(screen.getByTestId("by-account")).toBeInTheDocument();
    expect(screen.getByTestId("by-name")).toBeInTheDocument();
  });

  it("opens straight into the ask that was picked, rather than asking twice", () => {
    // Choosing "How you worked together" is already half the answer; the dialog should remember it.
    render(<ReferSomeone api={api} onGo={vi.fn()} />, { wrapper: wrapper() });
    fireEvent.click(screen.getByTestId(`ask-${POPULAR_ASKS[1].id}`));
    expect(screen.getByTestId("refer-dialog")).toHaveTextContent(POPULAR_ASKS[1].label);
  });

  it("still offers the references people are commonly asked for, including this deployment's", () => {
    render(<ReferSomeone api={api} onGo={vi.fn()} />, { wrapper: wrapper() });
    for (const ask of POPULAR_ASKS) expect(screen.getByTestId("popular-asks")).toHaveTextContent(ask.label);
    expect(POPULAR_ASKS.some((a) => /kim jong un/i.test(a.label))).toBe(true);
    expect(askById("kju-is")?.label).toMatch(/kim jong un/i);
    expect(askById("made-up")).toBeUndefined();
  });
});
