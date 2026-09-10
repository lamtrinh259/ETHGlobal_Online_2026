import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
  references: [],
  evidence: ["wallet_binding"],
  decision: "additional_context_available",
  warning: "This is not identity verification.",
};

const state = {
  vouches: [] as unknown[],
  disclosed: null as unknown,
  reader: undefined as string | undefined,
  /** What the attester answers with when nothing opens: 404 never shared, 403 not (or no longer) yours */
  refusal: 404,
};

// The reveal panel runs in the browser, because a permission addressed to one wallet only opens for it.
vi.mock("@privy-io/react-auth", () => ({
  useWallets: () => ({ wallets: state.reader ? [{ address: state.reader }] : [] }),
}));
vi.mock("@/app/providers", () => ({
  useWebConfig: () => ({ apiUrl: "http://api.test", attestUrl: "http://api.test/v1/attest" }),
}));

const { ApiError } = await import("@/lib/api");

vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  createApi: () => ({
    verify: vi.fn(async () => verification),
    vouches: vi.fn(async (handle: string) => ({
      handle,
      domain: `~${handle}`,
      vouches: state.vouches,
      warning: "This is not identity verification.",
    })),
    ens: vi.fn(async () => {
      throw new Error("off");
    }),
    explain: vi.fn(async (name: string) => ({
      name,
      says: "alice is a person's name here.",
      kind: "person" as const,
    })),
    disclosed: vi.fn(async (_name: string, _domain: string, reader?: string) => {
      // A grant addressed to one wallet opens for that wallet and no other.
      if (!state.disclosed || (state.reader && reader !== state.reader))
        throw new ApiError(state.refusal, "no disclosure for that account");
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

const renderPage = async (search: Record<string, string>) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const page = await VerifyPage({
    params: Promise.resolve({ name: "alice.ketsuban.eth" }),
    searchParams: Promise.resolve(search),
  });
  return render(<QueryClientProvider client={qc}>{page}</QueryClientProvider>);
};

describe("/v/<name> with an opened account", () => {
  it("shows the handle the candidate allowed", async () => {
    state.disclosed = {
      name: "alice.ketsuban.eth",
      domain: "x",
      disclosed: { handle: "alice_x", platformId: "7" },
      warning: "w",
    };
    state.reader = undefined;
    await renderPage({ reveal: "x" });
    await waitFor(() => expect(screen.getByTestId("revealed")).toHaveTextContent("@alice_x"));
    const panel = screen.getByTestId("revealed");
    expect(panel).toHaveTextContent("platform id 7");
    expect(panel).toHaveTextContent("never published");
  });

  it("tells a reader the sharing stopped, rather than that it never happened", async () => {
    // A permission that was taken back or ran out is a different fact from one that never existed, and
    // the reader is the person who needs to know which: one is worth asking about again, the other is not.
    state.disclosed = null;
    state.reader = undefined;
    state.refusal = 403;
    await renderPage({ reveal: "x" });
    await waitFor(() =>
      expect(screen.getByTestId("revealed")).toHaveTextContent(/no longer sharing|stopped sharing/i)
    );
    expect(screen.getByTestId("revealed")).not.toHaveTextContent("No live permission");
    state.refusal = 404;
  });

  it("says there is no live permission rather than failing the page", async () => {
    state.disclosed = null;
    state.reader = undefined;
    state.refusal = 404;
    await renderPage({ reveal: "x" });
    await waitFor(() => expect(screen.getByTestId("revealed")).toHaveTextContent("No live permission"));
    // The card itself still renders: a missing permission is not an error.
    expect(screen.getByRole("heading", { name: "alice.ketsuban.eth" })).toBeVisible();
  });

  it("asks as the signed-in wallet, so a permission addressed to one person opens for them", async () => {
    // Without the reader's own address the relay cannot tell whether the grant is theirs, and an
    // addressed permission would look like no permission at all.
    state.disclosed = {
      name: "alice.ketsuban.eth",
      domain: "x",
      disclosed: { handle: "alice_x", platformId: "7" },
      warning: "w",
    };
    state.reader = "0xd70B5E8A232Bf67F64658cbDDebe32e1443894a0";
    await renderPage({ reveal: "x" });
    await waitFor(() => expect(screen.getByTestId("revealed")).toHaveTextContent("@alice_x"));
  });

  it("says which wallet a link was addressed to, instead of showing an empty answer", async () => {
    // The address in the link is not a permission — the grant is — but without it a reader signed in as
    // the wrong wallet, or not at all, sees only that nothing opened.
    state.disclosed = null;
    state.reader = undefined;
    await renderPage({ reveal: "x", for: "0xd70B5E8A232Bf67F64658cbDDebe32e1443894a0" });
    await waitFor(() => expect(screen.getByTestId("revealed")).toHaveTextContent("Sign in with that wallet"));

    state.reader = "0xEE4811b9462956C9C3535E79c08776D769CA9F3a";
    await renderPage({ reveal: "x", for: "0xd70B5E8A232Bf67F64658cbDDebe32e1443894a0" });
    await waitFor(() =>
      expect(screen.getAllByTestId("revealed")[1]).toHaveTextContent("Only the addressed wallet")
    );
  });

  it("says what an unresolved name would have claimed", async () => {
    // "No record" is two different facts: nobody holds it, or it could never mean anything here.
    const { container } = await renderPage({});
    expect(container.querySelector("[data-testid=would-claim]")).toBeNull();

    const inactive = { ...verification, status: "inactive" as const };
    vi.spyOn(await import("@/lib/api"), "createApi").mockReturnValueOnce({
      verify: vi.fn(async () => inactive),
      ens: vi.fn(async () => null),
      explain: vi.fn(async () => ({ name: "x", says: "alice is a person's name here.", kind: "person" })),
      vouches: vi.fn(async () => ({ handle: "alice", domain: "~alice", vouches: [], warning: "" })),
    } as never);
    const page = await renderPage({});
    expect(page.container.querySelector("[data-testid=would-claim]")?.textContent).toContain(
      "a person's name here"
    );
  });

  it("shows nothing about disclosure when none was asked for", async () => {
    state.disclosed = null;
    state.reader = undefined;
    const { container } = await renderPage({});
    expect(container.querySelector("[data-testid=revealed]")).toBeNull();
  });
});

/**
 * A verifier arriving at a person's name came to read what others said about them. The page showed
 * only what the person said themselves, and offered no way to reach the rest.
 */
describe("/v/<name> for a person", () => {
  const vouch = {
    voucher: "bob",
    voucherName: "bob.ketsuban.eth",
    ensName: "bob.alice.ketsuban.eth",
    wallet: "0xEE4811b9462956C9C3535E79c08776D769CA9F3a",
    statement: "worked with them for years",
    validUntil: "2027-01-01T00:00:00.000Z",
    nonce: "1",
    live: true,
    solicited: false,
    invite: null,
  };

  it("shows the references written about them, and how to add one", async () => {
    state.vouches = [vouch];
    const { default: Page } = await import("@/app/v/[name]/page");
    render(
      await Page({
        params: Promise.resolve({ name: "alice.ketsuban.eth" }),
        searchParams: Promise.resolve({}),
      })
    );
    const received = screen.getByLabelText("references received");
    expect(received).toHaveTextContent("worked with them for years");
    // Anyone may refer anyone; a reader is owed the difference.
    expect(received).toHaveTextContent("unsolicited");
    expect(screen.getByRole("link", { name: "Refer this person" })).toHaveAttribute("href", "/vouch/alice");
  });

  it("invites the first reference when nobody has written one", async () => {
    state.vouches = [];
    const { default: Page } = await import("@/app/v/[name]/page");
    render(
      await Page({
        params: Promise.resolve({ name: "alice.ketsuban.eth" }),
        searchParams: Promise.resolve({}),
      })
    );
    expect(screen.getByLabelText("references received")).toHaveTextContent("none yet");
  });
});
