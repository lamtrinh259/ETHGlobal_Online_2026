import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

const api = {
  storeInvite: vi.fn(async () => ({ code: "abcd1234" })),
} as unknown as Api;

const { InviteLink } = await import("@/app/me/InviteLink");

describe("inviting someone to refer you", () => {
  beforeEach(() => {
    signed.length = 0;
    (api.storeInvite as ReturnType<typeof vi.fn>).mockClear();
  });

  it("makes a link short enough to send in a message", async () => {
    // A signed invitation encoded into the URL wraps in every chat client; the code stands for it.
    render(<InviteLink api={api} handle="alice" />);
    fireEvent.click(screen.getByTestId("make-invite"));
    await waitFor(() => expect(screen.getByTestId("invite-link")).toHaveTextContent("abcd1234"));
    const link = screen.getByTestId("invite-link").textContent!;
    expect(link.length).toBeLessThan(60);
    expect(link).toContain("/vouch/alice?invite=abcd1234");
  });

  it("asks the writer for the accounts the candidate picked, and signs over them", async () => {
    render(<InviteLink api={api} handle="alice" />);
    fireEvent.click(screen.getByTestId("require-linkedin.com"));
    fireEvent.click(screen.getByTestId("make-invite"));

    await waitFor(() => expect(signed).toHaveLength(1));
    // The requirement is only worth anything because it is part of what was signed.
    expect(signed[0]).toMatchObject({ handle: "alice", requires: ["linkedin.com"] });
  });

  it("takes an email domain the candidate types, for a university or a workplace", async () => {
    render(<InviteLink api={api} handle="alice" />);
    fireEvent.change(screen.getByTestId("require-domain"), { target: { value: "MIT.edu" } });
    fireEvent.click(screen.getByTestId("make-invite"));
    await waitFor(() => expect(signed).toHaveLength(1));
    // Lowercased, because a domain is a domain however it was typed.
    expect(signed[0]).toMatchObject({ requires: ["mit.edu"] });
  });

  it("asks for nothing by default, which is the common case", async () => {
    render(<InviteLink api={api} handle="alice" />);
    fireEvent.click(screen.getByTestId("make-invite"));
    await waitFor(() => expect(signed).toHaveLength(1));
    expect(signed[0]).toMatchObject({ requires: [] });
  });
});
