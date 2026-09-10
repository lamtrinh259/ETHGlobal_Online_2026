import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const state = {
  owner: null as string | null,
  canRegisterNames: true,
};
const claim = vi.fn();

vi.mock("@privy-io/react-auth", () => ({
  useAddFunds: () => ({ addFunds: vi.fn(async () => ({ method: "crypto", status: "completed" })) }),
}));
vi.mock("@/app/providers", () => ({
  useWebConfig: () => ({ chainId: 11155111, apiUrl: "http://api.test", attestUrl: "http://api.test" }),
}));
vi.mock("@/lib/hooks", () => ({
  useContracts: () => ({
    data: state.canRegisterNames
      ? { bridge: "0x01", ethRegistrar: "0x02", paymentToken: "0x03", permissionedResolver: "0x04" }
      : { bridge: "0x01", ethRegistrar: null, paymentToken: null, permissionedResolver: null },
  }),
  useEthLabel: () => ({ data: { label: "alice", registry: "0x02", owner: state.owner }, refetch: vi.fn() }),
  useGasTopup: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false, error: null }),
  useClaimEthName: () => ({ mutate: claim, isPending: false, error: null, waitingUntil: undefined }),
  useLinkOwnName: () => ({
    mutate: vi.fn(),
    isPending: false,
    error: null,
    isSuccess: false,
    data: undefined,
  }),
}));

const { OwnName } = await import("@/app/me/OwnName");

const WALLET = "0xEE4811b9462956C9C3535E79c08776D769CA9F3a" as const;
const props = {
  api: {} as never,
  wallet: WALLET,
  domain: "ketsuban",
  parentLabel: "ketsuban",
  handle: "alice",
  getSigner: vi.fn(),
};

describe("bringing your own .eth", () => {
  it("offers the free name as something to claim, paid for by the person", () => {
    state.owner = null;
    state.canRegisterNames = true;
    render(<OwnName {...props} />);
    // The revert this replaces said only NotNameOwner, which told the person nothing they could act on.
    expect(screen.getByTestId("own-name-owner")).toHaveTextContent("alice.eth is free");
    expect(screen.getByTestId("own-name-claim")).toHaveTextContent("Claim alice.eth");
    expect(screen.getByTestId("own-name")).toHaveTextContent("you pay for the name");
    expect(screen.getByTestId("own-name-link")).toBeDisabled();
  });

  it("links once the name is theirs, and never before", () => {
    state.owner = WALLET;
    render(<OwnName {...props} />);
    expect(screen.getByTestId("own-name-link")).toBeEnabled();
    expect(screen.queryByTestId("own-name-claim")).toBeNull();
    expect(screen.queryByTestId("own-name-owner")).toBeNull();
  });

  it("says who holds it when it is someone else", () => {
    state.owner = "0x1111111111111111111111111111111111111111";
    render(<OwnName {...props} />);
    expect(screen.getByTestId("own-name-owner")).toHaveTextContent("is held by 0x1111…1111");
    expect(screen.getByTestId("own-name-owner")).toHaveTextContent("Try another label");
    expect(screen.getByTestId("own-name-link")).toBeDisabled();
    // Registering is not on offer for a name someone owns.
    expect(screen.queryByTestId("own-name-claim")).toBeNull();
  });

  it("asks for gas before offering to claim, since the person sends that transaction", () => {
    state.owner = null;
    state.canRegisterNames = true;
    render(
      <OwnName
        {...props}
        balance="0"
        topup={{ enabled: true, available: true, amount: "2000000000000000" }}
      />
    );
    expect(screen.getByTestId("own-name-gas")).toHaveTextContent("needs a little ETH for gas");
    // The same ways of funding a wallet as anywhere else: the relay's ether, Privy, or the address.
    expect(screen.getByTestId("get-gas")).toBeVisible();
    expect(screen.getByTestId("fund-privy")).toBeVisible();
    expect(screen.queryByTestId("own-name-claim")).toBeNull();
  });

  it("offers the claim once the wallet can pay for it", () => {
    state.owner = null;
    state.canRegisterNames = true;
    render(<OwnName {...props} balance="2000000000000000" />);
    expect(screen.getByTestId("own-name-claim")).toBeVisible();
    expect(screen.queryByTestId("own-name-gas")).toBeNull();
  });

  it("offers nothing to register where the deployment cannot", () => {
    state.owner = null;
    state.canRegisterNames = false;
    render(<OwnName {...props} />);
    expect(screen.queryByTestId("own-name-claim")).toBeNull();
  });
});
