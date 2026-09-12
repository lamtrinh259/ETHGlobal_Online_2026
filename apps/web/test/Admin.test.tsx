import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Api } from "@/lib/api";

/**
 * Demo only: the page reads an account's humanity state and resets it, and says exactly what the
 * reset did — forgotten nullifiers, the record deleted or not, and why not.
 */
vi.mock("@/app/providers", () => ({
  useWebConfig: () => ({ apiUrl: "http://api.test", attestUrl: "http://api.test", instances: [] }),
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
