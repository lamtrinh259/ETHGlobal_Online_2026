import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Api } from "@/lib/api";

/**
 * Demo only: the page reads an account's humanity state and resets it, and says exactly what the
 * reset did — forgotten nullifiers, the record deleted or not, and why not.
 */
vi.mock("@/app/providers", () => ({
  useWebConfig: () => ({
    chainId: 11155111,
    apiUrl: "http://api.test",
    attestUrl: "http://api.test",
    instances: [],
  }),
}));
let current: Api;
vi.mock("@/lib/hooks", async (orig) => {
  const real = await orig<typeof import("@/lib/hooks")>();
  return { ...real, apiFor: () => current };
});

const WALLET = "0xEE4811b9462956C9C3535E79c08776D769CA9F3a";
const state = { wallet: WALLET, handle: "alice", onchain: { exists: true, nonce: "1" }, bound: 1 };

const show = async (api: Partial<Api>) => {
  current = api as Api;
  const { Admin } = await import("@/app/admin/Admin");
  render(<Admin />);
  fireEvent.change(screen.getByTestId("admin-token"), { target: { value: "admin-token-0123456789abcdef" } });
  fireEvent.change(screen.getByTestId("admin-who"), { target: { value: "alice" } });
};

describe("the admin reset", () => {
  it("looks an account up by handle, with the token, and shows what it holds", async () => {
    const adminHumanity = vi.fn(async () => state);
    await show({ adminHumanity });
    fireEvent.click(screen.getByTestId("admin-look"));
    await waitFor(() => expect(screen.getByTestId("admin-onchain")).toHaveTextContent("yes, nonce 1"));
    expect(screen.getByTestId("admin-bound")).toHaveTextContent("1");
    expect(adminHumanity).toHaveBeenCalledWith("admin-token-0123456789abcdef", { handle: "alice" });
  });

  it("resets after a confirmation and says what was forgotten and deleted", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const adminHumanityReset = vi.fn(async () => ({
      ...state,
      forgotten: 1,
      existed: true,
      deleted: { txHash: "0xabc" },
    }));
    const after = { ...state, onchain: { exists: false, nonce: "1" }, bound: 0 };
    let looks = 0;
    await show({ adminHumanity: vi.fn(async () => (looks++ === 0 ? state : after)), adminHumanityReset });
    fireEvent.click(screen.getByTestId("admin-look"));
    await waitFor(() => expect(screen.getByTestId("admin-reset")).toBeEnabled());
    fireEvent.click(screen.getByTestId("admin-reset"));
    await waitFor(() => expect(screen.getByTestId("admin-result")).toHaveTextContent("Forgot 1 nullifier"));
    // Deleting a record is a transaction like any other here, and it ends the same way.
    expect(screen.getByRole("dialog", { name: "Record deleted" })).toBeVisible();
    expect(screen.getByTestId("tx-done-link")).toHaveAttribute(
      "href",
      "https://sepolia.etherscan.io/tx/0xabc"
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByTestId("tx-done")).toBeNull();
    expect(screen.getByTestId("admin-result")).toHaveTextContent("Deleted the record on chain: 0xabc");
    expect(screen.getByTestId("admin-onchain")).toHaveTextContent("none");
    expect(adminHumanityReset).toHaveBeenCalledWith("admin-token-0123456789abcdef", { handle: "alice" });
  });

  it("says why the record could not be deleted, rather than claiming it was", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await show({
      adminHumanity: vi.fn(async () => state),
      adminHumanityReset: vi.fn(async () => ({
        ...state,
        forgotten: 0,
        existed: true,
        deleted: { error: "not the owner" },
      })),
    });
    fireEvent.click(screen.getByTestId("admin-look"));
    await waitFor(() => expect(screen.getByTestId("admin-reset")).toBeEnabled());
    fireEvent.click(screen.getByTestId("admin-reset"));
    await waitFor(() =>
      expect(screen.getByTestId("admin-result")).toHaveTextContent("could not be deleted: not the owner")
    );
    // Nothing landed on chain, so there is no transaction to confirm.
    expect(screen.queryByTestId("tx-done")).toBeNull();
  });

  it("shows the API's refusal as it is", async () => {
    await show({
      adminHumanity: vi.fn(async () => {
        throw new Error("unauthorized");
      }),
    });
    fireEvent.click(screen.getByTestId("admin-look"));
    await waitFor(() => expect(screen.getByTestId("admin-error")).toHaveTextContent("unauthorized"));
    expect(screen.getByTestId("admin-reset")).toBeDisabled();
  });
});

describe("the switch for everyone", () => {
  it("reads whether the check is in force and flips it after a confirmation", async () => {
    const calls: boolean[] = [];
    let required = true;
    await show({
      adminSelfieCheck: vi.fn(async () => ({ required, configured: true, offered: required })),
      adminSelfieCheckSet: vi.fn(async (_t: string, next: boolean) => {
        calls.push(next);
        required = next;
        return { required, configured: true, offered: required };
      }),
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByTestId("admin-policy-read"));
    await waitFor(() =>
      expect(screen.getByTestId("admin-policy-state")).toHaveTextContent("Right now: required")
    );
    expect(screen.getByTestId("admin-policy-flip")).toHaveTextContent(
      "Turn the Selfie Check off for everyone"
    );
    fireEvent.click(screen.getByTestId("admin-policy-flip"));
    await waitFor(() => expect(screen.getByTestId("admin-policy-state")).toHaveTextContent("Right now: off"));
    expect(screen.getByTestId("admin-policy-state")).toHaveTextContent("configured: required");
    expect(screen.getByTestId("admin-policy-flip")).toHaveTextContent("Require the Selfie Check again");
    expect(calls).toEqual([false]);
  });

  it("shows the API's refusal on the switch as it is", async () => {
    await show({
      adminSelfieCheck: vi.fn(async () => {
        throw new Error("admin disabled");
      }),
    });
    fireEvent.click(screen.getByTestId("admin-policy-read"));
    await waitFor(() => expect(screen.getByTestId("admin-policy-error")).toHaveTextContent("admin disabled"));
  });
});

describe("resetting a person's Privy accounts", () => {
  it("unlinks after a confirmation and says what went and what Privy refused", async () => {
    await show({
      adminPrivyUnlink: vi.fn(async () => ({
        wallet: WALLET,
        handle: "alice",
        did: "did:privy:alice",
        unlinked: [{ type: "github_oauth", handle: "42" }],
        failed: [{ type: "email", status: 400 }],
      })),
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByTestId("admin-unlink"));
    await waitFor(() =>
      expect(screen.getByTestId("admin-unlinked")).toHaveTextContent("Unlinked github_oauth")
    );
    expect(screen.getByTestId("admin-unlinked")).toHaveTextContent("Privy refused: email (400)");
  });
});

describe("resetting every Selfie Check", () => {
  it("resets after a confirmation and says how many were forgotten and deleted", async () => {
    await show({ adminHumanityResetAll: vi.fn(async () => ({ forgotten: 3, deleted: [{}, {}] })) });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByTestId("admin-reset-all"));
    await waitFor(() =>
      expect(screen.getByTestId("admin-reset-all-result")).toHaveTextContent(
        "Forgot 3 nullifiers, deleted 2 records"
      )
    );
  });
});

describe("the account list", () => {
  it("lists every account with its state, and resets one from its row", async () => {
    const rows = [
      { wallet: WALLET, handle: "alice", humanity: true, bound: 1 },
      { wallet: `0x${"77".repeat(20)}`, handle: null, humanity: false, bound: 0 },
    ];
    const reset = vi.fn(async () => ({
      wallet: WALLET,
      handle: "alice",
      forgotten: 1,
      existed: true,
      deleted: { txHash: "0x1" },
    }));
    await show({ adminAccounts: vi.fn(async () => rows), adminHumanityReset: reset });
    fireEvent.click(screen.getByTestId("admin-list"));
    await waitFor(() => expect(screen.getByTestId("admin-account-rows")).toBeInTheDocument());
    expect(screen.getByTestId(`admin-account-${WALLET}`)).toHaveTextContent("alice");
    expect(screen.getByTestId(`admin-account-0x${"77".repeat(20)}`)).toHaveTextContent("no name");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByTestId(`admin-row-reset-${WALLET}`));
    await waitFor(() =>
      expect(screen.getByTestId("admin-row-note")).toHaveTextContent("alice: forgot 1, deleted the record")
    );
    expect(reset).toHaveBeenCalledWith("admin-token-0123456789abcdef", { wallet: WALLET });
  });
});
