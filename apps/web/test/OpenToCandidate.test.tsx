import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Api, WalletDashboard } from "@/lib/api";

/**
 * A reference signed by somebody whose accounts are all masked cannot be attributed by the person who
 * received it. The masking is working as designed; what was missing is the way out of it.
 */
const WALLET = "0xEE4811b9462956C9C3535E79c08776D769CA9F3a";

vi.mock("@privy-io/react-auth", () => ({
  useWallets: () => ({ wallets: [{ walletClientType: "privy", address: WALLET }] }),
  useSignTypedData: () => ({ signTypedData: vi.fn(async () => ({ signature: "0x01" })) }),
}));
vi.mock("@/app/providers", () => ({
  useWebConfig: () => ({ chainId: 11155111, multipass: WALLET }),
}));
vi.mock("@/lib/keys", () => ({
  loadViewCodes: () => ({ "github.com": `0x${"22".repeat(32)}` }),
}));

const api = {
  enclaveKey: vi.fn(async () => ({
    publicKey:
      "0x0479be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8",
  })),
  disclose: vi.fn(async () => ({ id: "0xgrant", expiresAt: "2027-01-01T00:00:00.000Z" })),
} as unknown as Api;

const { OpenToCandidate } = await import("@/app/vouch/[handle]/OpenToCandidate");

const link = (domain: string, optedIn: boolean) =>
  ({
    domain,
    name: "",
    payload: "",
    validUntil: "2027-01-01T00:00:00.000Z",
    nonce: "1",
    live: true,
    optedIn,
    ensName: null,
  }) as WalletDashboard["links"][number];

const show = (links: WalletDashboard["links"]) =>
  render(
    <OpenToCandidate
      api={api}
      candidate="alice"
      rootParent="ketsuban.eth"
      voucherName="lam.ketsuban.eth"
      links={links}
    />
  );

describe("opening a masked account to the person you referred", () => {
  beforeEach(() => {
    (api.disclose as ReturnType<typeof vi.fn>).mockClear();
  });

  it("says nothing to a writer whose accounts are already public", () => {
    show([link("github.com", false)]);
    expect(screen.queryByTestId("open-to-candidate")).toBeNull();
  });

  it("addresses the permission to the candidate's name, not to a wallet", async () => {
    show([link("github.com", true)]);
    fireEvent.click(screen.getByRole("switch", { name: /github\.com/ }));
    fireEvent.click(screen.getByTestId("open-accounts"));
    await waitFor(() => expect(api.disclose).toHaveBeenCalled());
    const wire = (api.disclose as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // Written against the writer's own name: it is their account being opened.
    expect(wire.name).toBe("lam.ketsuban.eth");
    expect(wire.domains).toEqual(["github.com"]);
    // The candidate proves the name on chain when they read, so this holds even before they claim it.
    expect(wire.audienceName).toBe("alice.ketsuban.eth");
    expect(wire.audience).toBe("0x0000000000000000000000000000000000000000");
    expect(screen.getByTestId("opened")).toHaveTextContent("github.com");
  });

  it("opens nothing until something is picked", () => {
    show([link("github.com", true)]);
    expect(screen.getByTestId("open-accounts")).toBeDisabled();
    expect(api.disclose).not.toHaveBeenCalled();
  });

  it("says which account has no view code here, rather than failing silently", async () => {
    show([link("discord.com", true)]);
    fireEvent.click(screen.getByRole("switch", { name: /discord\.com/ }));
    fireEvent.click(screen.getByTestId("open-accounts"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("discord.com"));
    expect(api.disclose).not.toHaveBeenCalled();
  });
});
