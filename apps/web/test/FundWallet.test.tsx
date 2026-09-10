import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Api } from "@/lib/api";

const WALLET = "0xEE4811b9462956C9C3535E79c08776D769CA9F3a";
const funded: { address?: string; chain?: string } = {};

vi.mock("@privy-io/react-auth", () => ({
  useAddFunds: () => ({
    addFunds: vi.fn(async (opts: { destination: { address: string; chain: string } }) => {
      funded.address = opts.destination.address;
      funded.chain = opts.destination.chain;
      return { method: "crypto", status: "completed" };
    }),
  }),
}));
vi.mock("@/app/providers", () => ({
  useWebConfig: () => ({ chainId: 11155111, apiUrl: "http://api.test", attestUrl: "http://api.test" }),
}));

const gas = vi.fn(async () => ({ hash: "0xabc" }));
const api = { gas } as unknown as Api;
const { FundWallet } = await import("@/app/me/FundWallet");

const wrapper = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
};

const fund = (over: { balance?: string; available?: boolean } = {}) =>
  render(
    <FundWallet
      api={api}
      wallet={WALLET}
      balance={over.balance ?? "0"}
      topup={{ enabled: true, available: over.available ?? true, amount: "2000000000000000" }}
    />,
    { wrapper: wrapper() }
  );

describe("funding the wallet", () => {
  beforeEach(() => {
    funded.address = undefined;
    gas.mockClear();
  });

  it("says what the wallet holds in ether, not in wei", () => {
    fund({ balance: "2000000000000000" });
    // Nobody reads 2000000000000000 as an amount of money.
    expect(screen.getByTestId("balance")).toHaveTextContent("0.002 ETH");
    expect(screen.getByTestId("balance")).not.toHaveTextContent("2000000000000000");
  });

  it("offers the relay's test ether first, because that is the one that works here", async () => {
    fund();
    fireEvent.click(screen.getByTestId("get-gas"));
    await waitFor(() => expect(gas).toHaveBeenCalledTimes(1));
  });

  it("hands over to Privy for a wallet the relay will not top up again", async () => {
    fund({ available: false });
    // The relay gives once. After that, funding is the person's own to do.
    expect(screen.queryByTestId("get-gas")).toBeNull();
    fireEvent.click(screen.getByTestId("fund-privy"));
    await waitFor(() => expect(funded.address).toBe(WALLET));
    // The chain has to be the one this deployment is on, said the way Privy asks for it.
    expect(funded.chain).toBe("eip155:11155111");
  });

  it("shows the address to send to, for whoever would rather do it themselves", () => {
    fund();
    expect(screen.getByTestId("fund-address")).toHaveTextContent(WALLET);
  });

  it("says nothing is needed when the wallet already has enough", () => {
    fund({ balance: "50000000000000000", available: false });
    expect(screen.getByTestId("fund-wallet")).toHaveTextContent(/enough/i);
  });
});
