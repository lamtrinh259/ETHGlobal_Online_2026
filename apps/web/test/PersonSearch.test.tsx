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
  contracts: vi.fn(async () => ({
    instances: [
      { domain: "ketsuban", parentName: "ketsuban.eth", parentLabel: "ketsuban" },
      { domain: "~alice", parentName: "alice.ketsuban.eth", parentLabel: "alice" },
      { domain: "x.com", parentName: "com.x.www.ketsuban.eth", parentLabel: "com" },
      { domain: "gmail.com", parentName: "com.gmail.@.ketsuban.eth", parentLabel: "com" },
    ],
    bridge: null,
    permissionedResolver: null,
  })),
  who: vi.fn(async (_d: string, handle: string) =>
    handle === "bob_x"
      ? { found: true, candidate: "bob", standing: { claimed: true, given: 0, received: 4 } }
      : { found: false }
  ),
} as unknown as Api;

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

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

  it("asks what kind of thing is being typed inside the bar, not under the results", () => {
    /*
     * It sat below the suggestions, where it read as a setting to go and find after the search had
     * already failed to be what somebody meant. It belongs to the box being typed into.
     */
    show();
    const bar = screen.getByTestId("searchbar");
    expect(bar).toContainElement(screen.getByTestId("by-account"));
    expect(bar).toContainElement(screen.getByTestId("name-query"));
  });

  it("offers a way to empty the box once there is something in it", () => {
    show();
    expect(screen.queryByTestId("clear-query")).toBeNull();
    fireEvent.change(screen.getByTestId("name-query"), { target: { value: "bob" } });
    fireEvent.click(screen.getByTestId("clear-query"));
    expect((screen.getByTestId("name-query") as HTMLInputElement).value).toBe("");
  });

  it("is a box you can arrow down out of, and press enter in", async () => {
    /*
     * Every suggestion was a button, so reaching the third meant tabbing past the two above it and
     * whatever each row contained. A box people type into is one they expect to arrow out of.
     */
    const onPick = show();
    fireEvent.change(screen.getByTestId("name-query"), { target: { value: "bob" } });
    await waitFor(() => expect(screen.getByTestId("match-bob")).toBeInTheDocument());

    const box = screen.getByTestId("name-query");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(screen.getByTestId("match-bob").className).toContain("here");
    // The box says which suggestion Enter would take, for a reader who cannot see the highlight.
    expect(box).toHaveAttribute("aria-activedescendant", "hit:bob");

    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(screen.getByTestId("match-bobby").className).toContain("here");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith("bobby");
  });

  it("wraps around, and escape lets go of the list", async () => {
    show();
    fireEvent.change(screen.getByTestId("name-query"), { target: { value: "bob" } });
    await waitFor(() => expect(screen.getByTestId("match-bob")).toBeInTheDocument());
    const box = screen.getByTestId("name-query");

    fireEvent.keyDown(box, { key: "ArrowUp" });
    expect(screen.getByTestId("match-bobby").className).toContain("here");
    fireEvent.keyDown(box, { key: "Escape" });
    expect(screen.getByTestId("match-bobby").className).not.toContain("here");
    expect(box).not.toHaveAttribute("aria-activedescendant");
  });

  it("completes from the domains this deployment actually mounts, mail hosts included", async () => {
    /*
     * The list was six platforms written down here, so a mail host could not be searched at all and a
     * domain mounted after somebody attested there would never appear. A deployment mounts one the
     * first time an account is attested, so any list kept in the app is out of date by definition.
     */
    show();
    const offered = async () =>
      [...document.querySelectorAll("#search-domains option")].map((o) => o.getAttribute("value"));
    await waitFor(async () => expect(await offered()).toContain("x.com"));
    // A mail host is a domain somebody is known by, like any other.
    expect(await offered()).toContain("gmail.com");
    // Its own name domains and a candidate's vouch instance are not places an account lives.
    expect(await offered()).not.toContain("ketsuban");
    expect(await offered()).not.toContain("~alice");
  });

  it("searches a domain this app has never heard of, because the deployment might have", () => {
    /*
     * A grid of platforms could only ever offer the ones written into this app. A university mail
     * host is exactly the case an invitation asks for, and clicking anything on that grid would have
     * overwritten what somebody had already typed.
     */
    show();
    fireEvent.change(screen.getByTestId("by-account"), { target: { value: "mit.edu" } });
    expect(screen.getByLabelText("their account")).toBeInTheDocument();
    // Named where the handle is asked for, so it is clear which account is being looked up.
    expect(screen.getAllByText("mit.edu").length).toBeGreaterThan(0);
  });
});
