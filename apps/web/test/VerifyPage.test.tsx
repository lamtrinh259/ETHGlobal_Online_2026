import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * `/v/<name>` renders on the server, so its data never passes through the browser: a Playwright route
 * cannot intercept it. These tests drive the page function directly, which is the only way to cover what
 * a verifier sees when a candidate has opened an account for them.
 */
const verification = {
  name: "alice.ketsuban.eth",
  instance: { domain: "ketsuban", parentName: "ketsuban.eth" },
  status: "active" as const,
  wallet: "0xEE4811b9462956C9C3535E79c08776D769CA9F3a",
  answer: null,
  expiresAt: "2027-01-01T00:00:00.000Z",
  humanity: null,
  links: [{ domain: "x", optedIn: true, commitment: "0x01" }],
  evidence: ["wallet_binding"],
  decision: "additional_context_available",
  warning: "This is not identity verification.",
};

const state = { disclosed: null as unknown };

vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  createApi: () => ({
    verify: vi.fn(async () => verification),
    ens: vi.fn(async () => {
      throw new Error("off");
    }),
    disclosed: vi.fn(async () => {
      if (!state.disclosed) throw new Error("no disclosure for that account");
      return state.disclosed;
    }),
  }),
}));

vi.mock("@/lib/config", () => ({
  loadWebConfig: () => ({
    apiUrl: "http://api.test",
    attestUrl: "http://api.test/v1/attest",
    instances: [{ domain: "ketsuban", parentName: "ketsuban.eth", parentLabel: "ketsuban" }],
  }),
}));

const { default: VerifyPage } = await import("@/app/v/[name]/page");

const renderPage = async (search: Record<string, string>) =>
  render(
    await VerifyPage({
      params: Promise.resolve({ name: "alice.ketsuban.eth" }),
      searchParams: Promise.resolve(search),
    })
  );

describe("/v/<name> with an opened account", () => {
  it("shows the handle the candidate allowed", async () => {
    state.disclosed = {
      name: "alice.ketsuban.eth",
      domain: "x",
      disclosed: { handle: "alice_x", platformId: "7" },
      warning: "w",
    };
    await renderPage({ reveal: "x" });
    const panel = screen.getByTestId("revealed");
    expect(panel).toHaveTextContent("@alice_x");
    expect(panel).toHaveTextContent("platform id 7");
    expect(panel).toHaveTextContent("never published");
  });

  it("says there is no live permission rather than failing the page", async () => {
    state.disclosed = null;
    await renderPage({ reveal: "x" });
    expect(screen.getByTestId("revealed")).toHaveTextContent("No live permission");
    // The card itself still renders: a missing permission is not an error.
    expect(screen.getByRole("heading", { name: "alice.ketsuban.eth" })).toBeVisible();
  });

  it("shows nothing about disclosure when none was asked for", async () => {
    state.disclosed = null;
    const { container } = await renderPage({});
    expect(container.querySelector("[data-testid=revealed]")).toBeNull();
  });
});
