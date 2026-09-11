import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { Api } from "@/lib/api";

/**
 * Finding the person you mean.
 *
 * An account identifies somebody exactly; a name does not — two people really are called `bob`. The
 * name path does not pretend otherwise: it lists everyone of that name with the references each has
 * received, because nothing on chain settles which one is meant and the one people have vouched for is
 * the one they mean.
 */
vi.mock("@/app/providers", () => ({
  useWebConfig: () => ({ apiUrl: "http://api.test", instances: [{ domain: "ketsuban" }] }),
}));

const api = {
  find: vi.fn(async (q: string) => ({
    q,
    matches:
      q === "bob"
        ? [
            { handle: "bob", wallet: "0x1", claimed: true, given: 0, received: 4 },
            { handle: "bobby", wallet: "0x2", claimed: false, given: 0, received: 1 },
          ]
        : [],
  })),
  who: vi.fn(async (_d: string, handle: string) =>
    handle === "bob_x"
      ? { found: true, candidate: "bob", standing: { claimed: true, given: 0, received: 4 } }
      : { found: false }
  ),
} as unknown as Api;

const { PersonSearch } = await import("@/app/PersonSearch");

const show = (onPick = vi.fn()) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <PersonSearch api={api} onPick={onPick} action="Check this one" />
    </QueryClientProvider>
  );
  return onPick;
};

describe("finding the person you mean", () => {
  it("ranks people of one name by the references they have received", async () => {
    show();
    fireEvent.change(screen.getByLabelText("their name"), { target: { value: "bob" } });
    await waitFor(() => expect(screen.getByTestId("matches")).toBeInTheDocument());
    const rows = screen.getByTestId("matches").querySelectorAll("li");
    expect(rows[0]).toHaveTextContent("bob");
    expect(rows[0]).toHaveTextContent("4 references received");
    // Unclaimed is not hidden: a page can exist for somebody who has claimed nothing.
    expect(rows[1]).toHaveTextContent("unclaimed");
  });

  it("hands back the one that was picked", async () => {
    const onPick = show();
    fireEvent.change(screen.getByLabelText("their name"), { target: { value: "bob" } });
    await waitFor(() => expect(screen.getByTestId("pick-bobby")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("pick-bobby"));
    expect(onPick).toHaveBeenCalledWith("bobby");
  });

  it("offers a name nobody holds, rather than treating it as a dead end", async () => {
    const onPick = show();
    fireEvent.change(screen.getByLabelText("their name"), { target: { value: "nobody" } });
    await waitFor(() => expect(screen.getByTestId("no-match")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("use-anyway"));
    expect(onPick).toHaveBeenCalledWith("nobody");
  });

  it("identifies somebody exactly from an account of theirs", async () => {
    const onPick = show();
    fireEvent.change(screen.getByTestId("by-account"), { target: { value: "x.com" } });
    fireEvent.change(screen.getByLabelText("their account"), { target: { value: "bob_x" } });
    await waitFor(() => expect(screen.getByTestId("who-result")).toHaveTextContent("That is bob"));
    fireEvent.click(screen.getByTestId("who-go"));
    expect(onPick).toHaveBeenCalledWith("bob");
  });

  it("asks for a view code only when somebody says they have one", () => {
    show();
    fireEvent.change(screen.getByTestId("by-account"), { target: { value: "x.com" } });
    expect(screen.queryByLabelText("view code")).toBeNull();
    fireEvent.click(screen.getByTestId("have-viewcode"));
    // A private account is a one-time pad on chain; the code is the only way to reach it.
    expect(screen.getByLabelText("view code")).toBeInTheDocument();
  });

  it("says what an account can do that a name cannot, before anything is typed", () => {
    show();
    fireEvent.change(screen.getByTestId("by-account"), { target: { value: "x.com" } });
    expect(screen.getByTestId("who-result")).toHaveTextContent("identifies them exactly");
  });

  it("says what opening a name nobody holds actually makes", async () => {
    /*
     * It offered "anyway →" and nothing else. A page for a name nobody holds is a different thing
     * from a person's: references can be written on it, and none of it is tied to a real account
     * until somebody claims it. Worth knowing before making one, not after.
     */
    show();
    fireEvent.change(screen.getByTestId("name-query"), { target: { value: "nobody" } });
    await waitFor(() => expect(screen.getByTestId("no-match")).toBeInTheDocument());
    const said = screen.getByTestId("no-match").textContent ?? "";
    expect(said).toMatch(/none of it can be linked to a real account until/);
    expect(screen.getByTestId("use-anyway")).toBeInTheDocument();
    // And the way out of it: an account identifies somebody a bare name cannot.
    expect(screen.getByTestId("rather-account")).toBeInTheDocument();
  });
});
