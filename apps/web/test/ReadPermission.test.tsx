import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Api, WalletDashboard } from "@/lib/api";

const WALLET = "0xEE4811b9462956C9C3535E79c08776D769CA9F3a";
const BOB = "0xd70B5E8A232Bf67F64658cbDDebe32e1443894a0";
const ZERO = "0x0000000000000000000000000000000000000000";

vi.mock("@privy-io/react-auth", () => ({
  useWallets: () => ({ wallets: [{ walletClientType: "privy", address: WALLET }] }),
  useSignTypedData: () => ({ signTypedData: vi.fn(async () => ({ signature: "0x01" })) }),
}));
vi.mock("@/app/providers", () => ({
  useWebConfig: () => ({
    chainId: 11155111,
    multipass: WALLET,
    apiUrl: "http://api.test",
    attestUrl: "http://api.test",
    instances: [{ domain: "ketsuban", parentName: "ketsuban.eth", parentLabel: "ketsuban" }],
  }),
}));

const { ReadPermission, readerHandle } = await import("@/app/me/ReadPermission");

const link = (domain: string, ensName: string | null) => ({
  domain,
  name: "",
  payload: "",
  validUntil: "2027-01-01T00:00:00.000Z",
  nonce: "1",
  live: true,
  optedIn: true,
  ensName,
});

let grants: { domain: string; audience: string; expiresAt: string }[] = [];
const revoke = vi.fn(async (wire: { domain: string }) => {
  grants = grants.filter((g) => g.domain !== wire.domain);
  return { ok: true as const, domain: wire.domain };
});

const api = {
  nameStatus: vi.fn(async (_d: string, handle: string) => ({
    domain: "ketsuban",
    handle,
    taken: handle === "bob",
    wallet: handle === "bob" ? BOB : null,
    live: handle === "bob",
  })),
  disclosures: vi.fn(async (name: string) => ({ name, grants })),
  revoke,
} as unknown as Api;

const wrapper = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
};

const links = [link("discord.com", "alice.com.discord.private-www.ketsuban.eth")] as WalletDashboard["links"];

describe("sharing a private account", () => {
  beforeEach(() => {
    grants = [];
    revoke.mockClear();
  });

  it("reads a person's name the way people are named here", async () => {
    expect(readerHandle("bob.ketsuban.eth", "ketsuban.eth")).toBe("bob");
    expect(readerHandle("@Bob", "ketsuban.eth")).toBe("bob");
    expect(readerHandle("bob", "ketsuban.eth")).toBe("bob");
  });

  it("shares with anyone by default, and says so", () => {
    render(<ReadPermission api={api} links={links} name="alice.ketsuban.eth" />, { wrapper: wrapper() });
    // No address to paste before anything can be shared: the default is a link.
    expect(screen.queryByTestId("reader")).toBeNull();
    expect(screen.getByTestId("allow-discord.com")).toHaveTextContent("Share");
  });

  it("names the person a permission is bound to, and refuses to share until it resolves", async () => {
    render(<ReadPermission api={api} links={links} name="alice.ketsuban.eth" />, { wrapper: wrapper() });
    fireEvent.click(screen.getByTestId("scope-person"));
    const share = () => screen.getByTestId("allow-discord.com").querySelector("button") as HTMLButtonElement;
    expect(share()).toBeDisabled();

    fireEvent.change(screen.getByTestId("reader"), { target: { value: "nobody" } });
    await waitFor(() => expect(screen.getByTestId("reader-resolved")).toHaveTextContent("Nobody holds"));
    expect(share()).toBeDisabled();

    fireEvent.change(screen.getByTestId("reader"), { target: { value: "bob.ketsuban.eth" } });
    await waitFor(() =>
      expect(screen.getByTestId("reader-resolved")).toHaveTextContent("Only that wallet can open it")
    );
    expect(share()).toBeEnabled();
  });

  it("takes a wallet address without a lookup", async () => {
    render(<ReadPermission api={api} links={links} name="alice.ketsuban.eth" />, { wrapper: wrapper() });
    fireEvent.click(screen.getByTestId("scope-person"));
    fireEvent.change(screen.getByTestId("reader"), { target: { value: BOB } });
    expect(screen.getByTestId("reader-resolved")).toHaveTextContent("That wallet only");
  });
});

describe("permissions already given", () => {
  beforeEach(() => {
    revoke.mockClear();
    grants = [
      { domain: "discord.com", audience: BOB, expiresAt: "2027-03-01T00:00:00.000Z" },
      { domain: "x.com", audience: ZERO, expiresAt: "2027-02-01T00:00:00.000Z" },
    ];
  });

  it("answers who can read what, naming the reader rather than showing a bare address", async () => {
    render(<ReadPermission api={api} links={links} name="alice.ketsuban.eth" />, { wrapper: wrapper() });
    const list = await screen.findByTestId("granted-list");
    // A permission for one wallet and one for anybody are different facts and must not read alike.
    expect(list).toHaveTextContent("discord.com");
    expect(list).toHaveTextContent(/one wallet/i);
    expect(list).toHaveTextContent("x.com");
    expect(list).toHaveTextContent(/anyone with the link/i);
  });

  it("takes one back and stops listing it, leaving the others alone", async () => {
    render(<ReadPermission api={api} links={links} name="alice.ketsuban.eth" />, { wrapper: wrapper() });
    await screen.findByTestId("granted-list");
    fireEvent.click(screen.getByTestId("revoke-discord.com"));

    await waitFor(() => expect(revoke).toHaveBeenCalledTimes(1));
    // The signature covers this account only: revoking one share must not touch another.
    expect(revoke.mock.calls[0][0]).toMatchObject({ name: "alice.ketsuban.eth", domain: "discord.com" });
    await waitFor(() => expect(screen.queryByTestId("revoke-discord.com")).toBeNull());
    expect(screen.getByTestId("revoke-x.com")).toBeInTheDocument();
  });

  it("says nothing is shared rather than showing an empty box", async () => {
    grants = [];
    render(<ReadPermission api={api} links={links} name="alice.ketsuban.eth" />, { wrapper: wrapper() });
    await waitFor(() => expect(screen.getByTestId("granted-none")).toHaveTextContent(/nobody/i));
  });
});
