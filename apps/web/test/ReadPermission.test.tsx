import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Api, WalletDashboard } from "@/lib/api";

const WALLET = "0xEE4811b9462956C9C3535E79c08776D769CA9F3a";
const BOB = "0xd70B5E8A232Bf67F64658cbDDebe32e1443894a0";

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

const api = {
  nameStatus: vi.fn(async (_d: string, handle: string) => ({
    domain: "ketsuban",
    handle,
    taken: handle === "bob",
    wallet: handle === "bob" ? BOB : null,
    live: handle === "bob",
  })),
} as unknown as Api;

const wrapper = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
};

const links = [link("discord.com", "alice.com.discord.private-www.ketsuban.eth")] as WalletDashboard["links"];

describe("sharing a private account", () => {
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
