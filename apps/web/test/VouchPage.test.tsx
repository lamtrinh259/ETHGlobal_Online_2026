import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

/**
 * `/vouch/<handle>` asks for a permanent signature. It used to ask for it while showing nothing but
 * the handle, so a voucher arriving from someone else's page could not see who they were about to put
 * their own name behind.
 */
const state = {
  profile: null as {
    avatar: string | null;
    description: string | null;
    url: string | null;
    email: string | null;
  } | null,
};

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ ready: true, authenticated: false, user: null, login: vi.fn() }),
  useWallets: () => ({ wallets: [] }),
  useIdentityToken: () => ({ identityToken: null }),
  useSignTypedData: () => ({ signTypedData: vi.fn() }),
  useLinkAccount: () => ({}),
}));
vi.mock("@/app/providers", () => ({
  useWebConfig: () => ({
    apiUrl: "http://api.test",
    attestUrl: "http://api.test/v1/attest",
    instances: [{ domain: "ketsuban", parentName: "ketsuban.eth", parentLabel: "ketsuban" }],
  }),
}));
vi.mock("@/lib/config", () => ({
  loadWebConfig: () => ({
    apiUrl: "http://api.test",
    attestUrl: "http://api.test/v1/attest",
    instances: [{ domain: "ketsuban", parentName: "ketsuban.eth", parentLabel: "ketsuban" }],
  }),
}));
// The flow itself is covered by its own tests; this one is about what the page says before it.
vi.mock("@/app/vouch/[handle]/VouchFlow", () => ({ VouchFlow: () => null }));
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  createApi: () => ({
    nameStatus: vi.fn(async () => ({ handle: "alice", taken: true, live: true, wallet: null })),
    vouches: vi.fn(async (handle: string) => ({ handle, domain: `~${handle}`, vouches: [], warning: "" })),
    verify: vi.fn(async (name: string) => ({ name, profile: state.profile })),
  }),
}));

const { default: VouchPage } = await import("@/app/vouch/[handle]/page");

const renderPage = async (handle: string) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const page = await VouchPage({
    params: Promise.resolve({ handle }),
    searchParams: Promise.resolve({}),
  });
  return render(<QueryClientProvider client={qc}>{page}</QueryClientProvider>);
};

describe("/vouch/<handle>", () => {
  it("shows who the reference is about, with the same head as every other page about someone", async () => {
    state.profile = {
      avatar: "https://i.example/alice.png",
      description: "infra lead",
      url: "https://alice.example",
      email: null,
    };
    await renderPage("alice");
    expect(screen.getByTestId("head-avatar")).toHaveAttribute("src", "https://i.example/alice.png");
    expect(screen.getByTestId("profile-head")).toHaveTextContent("infra lead");
    expect(screen.getByTestId("profile-head")).toHaveTextContent("alice.ketsuban.eth");
  });

  it("keeps its shape for a handle with no profile records at all", async () => {
    state.profile = null;
    await renderPage("alice");
    // The slot still holds its place, so the page does not reflow when a picture lands — but it is a
    // placeholder, not an image of nothing.
    expect(screen.getByTestId("head-avatar").tagName).toBe("SPAN");
    expect(screen.getByTestId("head-avatar")).not.toHaveAttribute("src");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Refer");
  });

  it("refuses a handle that could never name anybody", async () => {
    await renderPage("not a handle");
    expect(screen.getByRole("alert")).toHaveTextContent("not a valid handle");
  });
});
