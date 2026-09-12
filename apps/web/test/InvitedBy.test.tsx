import { render, renderHook, screen, waitFor } from "@testing-library/react";
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

let current: Api;
vi.mock("@/lib/hooks", async (orig) => {
  const real = await orig<typeof import("@/lib/hooks")>();
  return { ...real, apiFor: () => current };
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
