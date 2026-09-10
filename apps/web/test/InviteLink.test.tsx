import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Api } from "@/lib/api";

const WALLET = "0xEE4811b9462956C9C3535E79c08776D769CA9F3a";
const signed: object[] = [];

vi.mock("@privy-io/react-auth", () => ({
  useWallets: () => ({ wallets: [{ walletClientType: "privy", address: WALLET }] }),
  useSignTypedData: () => ({
    signTypedData: vi.fn(async (td: { message: object }) => {
      signed.push(td.message);
      return { signature: "0x01" };
    }),
  }),
}));
vi.mock("@/app/providers", () => ({
  useWebConfig: () => ({ chainId: 11155111, multipass: WALLET, apiUrl: "http://api.test" }),
}));

let existing: { code: string; requires: string[]; expiresAt: string }[] = [];
const api = {
  storeInvite: vi.fn(async () => ({ code: "abcd1234" })),
  invites: vi.fn(async (handle: string) => ({ handle, invites: existing })),
} as unknown as Api;

const { InviteLink: Raw } = await import("@/app/me/InviteLink");

/** The component reads its own invitations, so every render needs a query client. */
const InviteLink = (props: Parameters<typeof Raw>[0]) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <Raw {...props} />
  </QueryClientProvider>
);

describe("inviting someone to refer you", () => {
  beforeEach(() => {
    existing = [];
    signed.length = 0;
    (api.storeInvite as ReturnType<typeof vi.fn>).mockClear();
  });

  it("keeps the choices behind the CTA, so the section is an offer rather than a form", () => {
    render(<InviteLink api={api} handle="alice" />);
    // Nothing to decide until someone says they want an invitation.
    expect(screen.queryByTestId("platform-linkedin.com")).toBeNull();
    expect(screen.queryByTestId("require-domain")).toBeNull();

    fireEvent.click(screen.getByTestId("open-invite"));
    expect(screen.getByTestId("platform-linkedin.com")).toBeInTheDocument();
    expect(screen.getByTestId("make-invite")).toBeInTheDocument();
  });

  it("makes a link short enough to send in a message", async () => {
    // A signed invitation encoded into the URL wraps in every chat client; the code stands for it.
    existing = [{ code: "abcd1234", requires: [], expiresAt: "2027-01-01T00:00:00.000Z" }];
    render(<InviteLink api={api} handle="alice" />);
    await waitFor(() => expect(screen.getByTestId("invite-abcd1234")).toBeInTheDocument());
    expect(screen.getByTestId("invite-abcd1234")).toHaveTextContent("abcd1234");
  });

  it("asks the writer for the accounts the candidate picked, and signs over them", async () => {
    render(<InviteLink api={api} handle="alice" />);
    fireEvent.click(screen.getByTestId("open-invite"));
    fireEvent.click(screen.getByTestId("platform-linkedin.com"));
    fireEvent.click(screen.getByTestId("make-invite"));

    await waitFor(() => expect(signed).toHaveLength(1));
    // The requirement is only worth anything because it is part of what was signed.
    expect(signed[0]).toMatchObject({ handle: "alice", requires: ["linkedin.com"] });
  });

  it("takes an email domain the candidate types, for a university or a workplace", async () => {
    render(<InviteLink api={api} handle="alice" />);
    fireEvent.click(screen.getByTestId("open-invite"));
    fireEvent.change(screen.getByTestId("require-domain"), { target: { value: "MIT.edu" } });
    fireEvent.click(screen.getByTestId("make-invite"));
    await waitFor(() => expect(signed).toHaveLength(1));
    // Lowercased, because a domain is a domain however it was typed.
    expect(signed[0]).toMatchObject({ requires: ["mit.edu"] });
  });

  it("asks for nothing by default, which is the common case", async () => {
    render(<InviteLink api={api} handle="alice" />);
    fireEvent.click(screen.getByTestId("open-invite"));
    fireEvent.click(screen.getByTestId("make-invite"));
    await waitFor(() => expect(signed).toHaveLength(1));
    expect(signed[0]).toMatchObject({ requires: [] });
  });
});

describe("invitations already made", () => {
  beforeEach(() => {
    existing = [
      { code: "aaaa1111", requires: ["linkedin.com", "mit.edu"], expiresAt: "2027-01-01T00:00:00.000Z" },
    ];
  });

  it("lists them, so closing the page does not lose a link", async () => {
    // The link lived in component state; a reload lost it and the candidate had to sign another.
    render(<InviteLink api={api} handle="alice" />);
    await waitFor(() => expect(screen.getByTestId("invite-aaaa1111")).toBeInTheDocument());
    expect(screen.getByTestId("invite-aaaa1111")).toHaveTextContent("aaaa1111");
  });

  it("says what each one asks the writer to connect, so it can be checked before sending", async () => {
    render(<InviteLink api={api} handle="alice" />);
    await waitFor(() => expect(screen.getByTestId("invite-aaaa1111")).toBeInTheDocument());
    const row = screen.getByTestId("invite-aaaa1111");
    expect(row).toHaveTextContent("linkedin.com");
    expect(row).toHaveTextContent("mit.edu");
  });
});
