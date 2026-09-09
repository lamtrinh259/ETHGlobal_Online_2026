import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { OnChain } from "@/app/me/OnChain";
import type { Api, WalletDashboard } from "@/lib/api";

const WALLET = "0xEE4811b9462956C9C3535E79c08776D769CA9F3a";
const wrapper = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
};

const rec = (domain: string, name: string, payload = "", live = true) => ({
  domain,
  name,
  payload,
  validUntil: "2027-01-01T00:00:00.000Z",
  nonce: "1",
  live,
});

const dash: WalletDashboard = {
  address: WALLET,
  names: [{ ...rec("ketsuban", "alice"), ensName: "alice.ketsuban.eth" }],
  links: [
    { ...rec("x", "alice_x"), optedIn: false, ensName: "alice_x.x.ketsuban.eth" },
    { ...rec("google", "masked"), optedIn: true, ensName: null },
    { ...rec("github", "old", "", false), optedIn: false, ensName: "old.github.ketsuban.eth" },
  ],
  given: [],
  balance: "0",
  gasTopup: { enabled: false, amount: "0", available: false },
  warning: "w",
};

const api = (name: string | null) =>
  ({
    reverse: vi.fn(async (address: string) => ({
      address,
      name,
      names: name ? [{ domain: "ketsuban", name, resolver: WALLET }] : [],
      note: "answered from the Multipass record, not from a reverse registry",
    })),
  }) as unknown as Api;

describe("OnChain", () => {
  it("lists every readable name, says why a private account has none, and shows the reverse answer", async () => {
    render(<OnChain api={api("alice.ketsuban.eth")} wallet={WALLET} dash={dash} />, { wrapper: wrapper() });

    const names = screen.getByTestId("onchain-names");
    expect(names).toHaveTextContent("alice.ketsuban.eth");
    expect(names).toHaveTextContent("alice_x.x.ketsuban.eth");
    // An expired record is not a name anyone can read.
    expect(names).not.toHaveTextContent("old.github.ketsuban.eth");

    expect(screen.getByTestId("onchain-masked")).toHaveTextContent("google is attested but private");

    await waitFor(() => expect(screen.getByTestId("reverse")).toHaveTextContent("gets alice.ketsuban.eth"));
  });

  it("says plainly when an address answers to nothing", async () => {
    render(<OnChain api={api(null)} wallet={WALLET} dash={{ ...dash, names: [], links: [] }} />, {
      wrapper: wrapper(),
    });
    expect(screen.getByTestId("onchain")).toHaveTextContent("Nothing yet");
    await waitFor(() => expect(screen.getByTestId("reverse")).toHaveTextContent("resolves to no name yet"));
  });
});
