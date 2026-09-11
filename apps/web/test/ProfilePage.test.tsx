import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { ProfileRead } from "@/lib/api";

/**
 * `/p/<handle>` renders on the server, so a Playwright route cannot intercept its data. These drive the
 * page function directly, which is the only way to cover what a reader sees for a handle nobody holds.
 */
const state = {
  claim: { says: "alice is a person's name here.", kind: "person" } as { says: string; kind: string },
};

const empty: ProfileRead = {
  handle: "x",
  names: [],
  vouches: [],
  standing: { claimed: false, given: 0, received: 0 },
  warning: "This is not identity verification.",
};

vi.mock("@privy-io/react-auth", () => ({ useWallets: () => ({ wallets: [] }) }));
vi.mock("@/app/providers", () => ({
  useWebConfig: () => ({ apiUrl: "http://api.test", attestUrl: "http://api.test/v1/attest" }),
}));

vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  createApi: () => ({
    profile: vi.fn(async () => empty),
    ens: vi.fn(async () => {
      throw new Error("off");
    }),
    explain: vi.fn(async (name: string) => ({ name, ...state.claim })),
  }),
}));

vi.mock("@/lib/config", () => ({
  loadWebConfig: () => ({
    apiUrl: "http://api.test",
    attestUrl: "http://api.test/v1/attest",
    nameDomains: ["ketsuban"],
    instances: [{ domain: "ketsuban", parentName: "ketsuban.eth", parentLabel: "ketsuban" }],
    questions: {},
  }),
}));

const { default: ProfilePage } = await import("@/app/p/[handle]/page");

const renderPage = async (handle: string) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const page = await ProfilePage({
    params: Promise.resolve({ handle }),
    searchParams: Promise.resolve({}),
  });
  return render(<QueryClientProvider client={qc}>{page}</QueryClientProvider>);
};

describe("/p/<handle> for a label nobody can claim", () => {
  it("says what the mount is instead of grading it against a hiring policy", async () => {
    // `x` is where the X accounts hang. Graded as a candidate it reads "unclaimed", "incomplete" and a
    // row of failed checks — a verdict on a name the registrar will never let a person hold.
    state.claim = {
      says: "x.ketsuban.eth is where this deployment mounts the accounts attested at x. It is not a name a person can hold.",
      kind: "mount",
    };
    await renderPage("x");
    expect(screen.getByTestId("mount-name")).toHaveTextContent("not a name a person can hold");
    expect(screen.queryByText("unclaimed")).toBeNull();
    expect(screen.queryByText(/Vouches/)).toBeNull();
    state.claim = { says: "alice is a person's name here.", kind: "person" };
  });

  it("still grades a handle that is somebody's", async () => {
    await renderPage("alice");
    expect(screen.queryByTestId("mount-name")).toBeNull();
  });
});
