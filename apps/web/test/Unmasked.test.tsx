import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * A view code that arrives in a link is kept — in this browser, by the name it opens, and with the
 * service against the session — so the person never has to hold it or find the link again.
 */
const CODE = `0x${"5a".repeat(32)}`;
// jsdom serves this file from about:blank, where there is no localStorage; the component's store must
// still be one, so a small one stands in.
const memory = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
    clear: () => memory.clear(),
  },
});
const kept: { name: string; code: string }[] = [];
const api = {
  verify: vi.fn(async () => ({
    links: [{ domain: "github.com", disclosed: { handle: "lam", platformId: "1" } }],
  })),
  keepViewCode: vi.fn(async (_t: string, name: string, code: string) => {
    kept.push({ name, code });
  }),
};
vi.mock("@privy-io/react-auth", () => ({ useIdentityToken: () => ({ identityToken: "token" }) }));
vi.mock("@/app/providers", () => ({
  useWebConfig: () => ({ apiUrl: "http://api.test", attestUrl: "http://api.test" }),
}));
vi.mock("@/lib/hooks", async (orig) => ({
  ...(await orig<typeof import("@/lib/hooks")>()),
  apiFor: () => api,
  useVerification: (_api: unknown, name: string) => ({
    data: name
      ? { links: [{ domain: "github.com", disclosed: { handle: "lam", platformId: "1" } }] }
      : undefined,
    isPending: false,
    isError: false,
  }),
}));

const { Unmasked } = await import("@/app/Unmasked");
const show = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Unmasked name="alice.ketsuban.eth" domains={["github.com"]} />
    </QueryClientProvider>
  );

describe("a view code arriving in the link", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    kept.length = 0;
    window.location.hash = "";
  });

  it("is kept by the name it opens, and handed to the service against the session", async () => {
    window.location.hash = `#viewCode=${CODE}`;
    show();
    await waitFor(() => expect(screen.getByTestId("unmasked-links")).toBeInTheDocument());
    expect(JSON.parse(localStorage.getItem("ketsuban:given-viewcodes") ?? "{}")).toEqual({
      "alice.ketsuban.eth": CODE,
    });
    await waitFor(() => expect(kept).toEqual([{ name: "alice.ketsuban.eth", code: CODE }]));
  });

  it("opens the page again from what was kept, with no code in the link", async () => {
    localStorage.setItem("ketsuban:given-viewcodes", JSON.stringify({ "alice.ketsuban.eth": CODE }));
    show();
    await waitFor(() => expect(screen.getByTestId("unmasked-links")).toBeInTheDocument());
  });

  it("shows nothing when there is no code anywhere", () => {
    show();
    expect(screen.queryByTestId("unmasked")).toBeNull();
  });
});
