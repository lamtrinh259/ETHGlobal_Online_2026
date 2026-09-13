import { fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { Api, PolicyInviteRead } from "@/lib/api";

/**
 * The block that meets somebody at `/me?invite=<code>` says who is asking, from the record, and moves
 * on its own once the person has done what it asked — they are on this page doing it.
 */
vi.mock("@/app/providers", () => ({
  useWebConfig: () => ({
    apiUrl: "http://api.test",
    attestUrl: "http://api.test",
    instances: [
      { domain: "ketsuban", parentName: "ketsuban.eth" },
      { domain: "kju-is", parentName: "kju-is.ketsuban.eth" },
    ],
  }),
}));

vi.mock("@/app/AttestFlow", () => ({
  AttestFlow: ({
    fixedDomain,
    onPublished,
  }: {
    fixedDomain?: string;
    onPublished?: (p: unknown) => void;
  }) => (
    <div data-testid="attest" data-domain={fixedDomain ?? ""}>
      <button
        data-testid="fake-publish"
        onClick={() => onPublished?.({ domain: fixedDomain, txHash: "0x1" })}
      >
        publish
      </button>
    </div>
  ),
}));
vi.mock("@/app/me/HumanityCheck", () => ({ HumanityCheck: () => <div data-testid="fake-human" /> }));
vi.mock("@/app/me/InviteLink", () => ({ InviteLink: () => <div data-testid="fake-invite-link" /> }));
let current: Api;
const session = { authenticated: false, held: undefined as string | undefined };
vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ ready: true, authenticated: session.authenticated }),
  useWallets: () => ({
    wallets: [{ walletClientType: "privy", address: "0xEE4811b9462956C9C3535E79c08776D769CA9F3a" }],
  }),
}));
vi.mock("@/lib/hooks", async (orig) => {
  const real = await orig<typeof import("@/lib/hooks")>();
  return {
    ...real,
    apiFor: () => current,
    useWalletDashboard: () => ({
      refetch: vi.fn(async () => undefined),
      data: session.held
        ? {
            names: [
              { domain: "ketsuban", name: session.held, live: true, ensName: `${session.held}.ketsuban.eth` },
            ],
          }
        : undefined,
    }),
  };
});

const invitation: PolicyInviteRead = {
  code: "0123456789abcdef0123456789abcdef",
  kind: "policy",
  inviter: "peersky",
  inviterName: "peersky.ketsuban.eth",
  platform: "github.com",
  account: "lamtrinh259",
  policy: "answers=kju-is&minLinks=1&minVouches=2",
  expiresAt: "2099-01-01T00:00:00.000Z",
  expired: false,
  status: "invited",
  candidate: null,
};

const show = async (answer: () => Promise<unknown>, code = invitation.code) => {
  current = { invite: vi.fn(answer) } as Partial<Api> as Api;
  const { InvitedBy } = await import("@/app/me/InvitedBy");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <InvitedBy code={code} />
    </QueryClientProvider>
  );
};

describe("an invitation on your own page", () => {
  it("says who is asking, the bar, and which account to begin with", async () => {
    await show(async () => invitation);
    await waitFor(() => expect(screen.getByTestId("invited")).toHaveTextContent("peersky.ketsuban.eth"));
    expect(screen.getByTestId("invited-bar")).toHaveTextContent("≥2 live references");
    expect(screen.getByTestId("invited-begin")).toHaveTextContent("github.com");
    expect(screen.getByTestId("invited-begin")).toHaveTextContent("@lamtrinh259");
  });

  it("keeps reading, so it moves on once the person has a page, without a reload", async () => {
    await show(async () => ({ ...invitation, status: "linked" }));
    await waitFor(() => expect(screen.getByTestId("invited-linked")).toBeInTheDocument());
    // The read is scheduled to repeat: the person is on this page doing what the block asks.
    const { useInvite } = await import("@/lib/hooks");
    const qc = new QueryClient();
    const { result } = renderHook(() => useInvite(current, invitation.code), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const options = qc.getQueryCache().find({ queryKey: ["invite", invitation.code] })?.options as
      { refetchInterval?: number } | undefined;
    expect(options?.refetchInterval).toBe(10_000);
  });

  it("tells somebody named by their handle to claim the name, not to connect an account", async () => {
    await show(async () => ({ ...invitation, platform: "ketsuban", account: "alice" }));
    await waitFor(() => expect(screen.getByTestId("invited-begin")).toHaveTextContent("claiming your name"));
    expect(screen.getByTestId("invited-begin")).toHaveTextContent("alice");
  });

  it("reads the page against the bar once there is one", async () => {
    await show(async () => ({ ...invitation, status: "claimed", candidate: "lam" }));
    await waitFor(() => expect(screen.getByTestId("invited-claimed")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: /Read lam against the bar/ })).toHaveAttribute(
      "href",
      "/p/lam?answers=kju-is&minLinks=1&minVouches=2"
    );
  });

  it("sends the other kind of invitation to the vouch page", async () => {
    await show(async () => ({
      code: invitation.code,
      kind: "vouch",
      invite: { handle: "alice", voucher: "0x0", exp: "1", signature: "0x01" },
    }));
    await waitFor(() => expect(screen.getByTestId("invited-to-vouch")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Write it" })).toHaveAttribute(
      "href",
      `/vouch/alice?invite=${invitation.code}`
    );
  });

  it("says a code nobody kept is one, and shows nothing at all without a code", async () => {
    await show(async () => {
      throw new Error("404");
    });
    await waitFor(() => expect(screen.getByTestId("invited-unknown")).toBeInTheDocument());
  });
});

describe("what the bar needs from you, line by line", () => {
  const withProfile = (answer: string | null, vouches: number, links = 1) =>
    ({
      invite: vi.fn(async () => invitation),
      profile: vi.fn(async () => ({
        names: [
          {
            name: "peersky.ketsuban.eth",
            verification: {
              status: "active",
              name: "peersky.ketsuban.eth",
              wallet: "0xEE4811b9462956C9C3535E79c08776D769CA9F3a",
              links: Array.from({ length: links }, (_, i) => ({ domain: `p${i}.com`, optedIn: false })),
              humanity: null,
            },
          },
          {
            name: "peersky.kju-is.ketsuban.eth",
            verification: answer ? { status: "active", answer, taken: true } : null,
          },
        ],
        vouches: Array.from({ length: vouches }, (_, i) => ({
          voucher: `v${i}`,
          live: true,
          solicited: true,
        })),
      })),
    }) as unknown as Api;

  it("ticks what is met, marks what is missing with where to fix it", async () => {
    session.authenticated = true;
    session.held = "peersky";
    current = withProfile(null, 1);
    const { InvitedBy } = await import("@/app/me/InvitedBy");
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <InvitedBy code={invitation.code} />
      </QueryClientProvider>
    );
    await waitFor(() => expect(screen.getByTestId("invited-checks")).toBeInTheDocument());
    expect(screen.getByTestId("invited-check-identity").className).toBe("done");
    expect(screen.getByTestId("invited-check-links").className).toBe("done");
    const answer = screen.getByTestId("invited-check-answer:kju-is");
    expect(answer.className).toBe("todo");
    // The fix happens here, in a dialog over the checklist: nothing scrolls away.
    const profileReads = (current.profile as ReturnType<typeof vi.fn>).mock.calls.length;
    fireEvent.click(screen.getByTestId("invited-fix-answer:kju-is"));
    expect(
      screen
        .getByTestId("invited-fixing")
        .querySelector("[data-testid='attest']")
        ?.getAttribute("data-domain")
    ).toBe("kju-is");
    fireEvent.click(screen.getByTestId("fake-publish"));
    await waitFor(() =>
      expect((current.profile as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(profileReads)
    );
    expect(answer.querySelector("a")).toBeNull();
    const vouches = screen.getByTestId("invited-check-vouches");
    expect(vouches.className).toBe("todo");
    expect(screen.getByTestId("invited-fix-vouches")).toBeInTheDocument();
    expect(screen.getByTestId("invited-progress").textContent).toContain("2 of 4 met");
    expect(screen.queryByTestId("invited-pass")).toBeNull();
    expect(screen.queryByTestId("invited-pass-modal")).toBeNull();
    expect(screen.queryByTestId("invited-begin")).toBeNull();
    session.authenticated = false;
    session.held = undefined;
  });

  it("says so when every line is met, with the page to send and a note if the invitation named another handle", async () => {
    session.authenticated = true;
    session.held = "peersky";
    current = withProfile("dictator", 2);
    const { InvitedBy } = await import("@/app/me/InvitedBy");
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <InvitedBy code={invitation.code} />
      </QueryClientProvider>
    );
    await waitFor(() => expect(screen.getByTestId("invited-pass")).toBeInTheDocument());
    expect(screen.getByTestId("invited-progress").textContent).toContain("4 of 4 met");
    // The moment it is met, it says so in a modal on top; closing it leaves the green card and the link.
    await waitFor(() => expect(screen.getByTestId("invited-pass-modal")).toBeInTheDocument());
    expect(screen.getByTestId("invited-pass-modal").textContent).toContain("You pass peersky.ketsuban.eth");
    expect(screen.getByTestId("invited").className).toContain("invited-pass");
    expect(screen.getByTestId("invited-pass").textContent).toContain("You pass peersky.ketsuban.eth");
    expect(screen.getByTestId("invited-pass").textContent).toContain("/p/peersky?answers=kju-is");
    expect(screen.getByTestId("invited-named-other").textContent).toContain("lamtrinh259");
    session.authenticated = false;
    session.held = undefined;
  });
});
