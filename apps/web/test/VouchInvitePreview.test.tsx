import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * What a writer can see before they start.
 *
 * An invitation asks for accounts, and linking one is a detour through the writer's own profile.
 * Finding that out three steps in is how somebody ends up publishing a reference that does not count
 * as the one they were asked for, so the ask is readable from the link itself.
 */
const WALLET = "0xEE4811b9462956C9C3535E79c08776D769CA9F3a";

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ ready: true, authenticated: false }),
  useSignTypedData: () => ({ signTypedData: vi.fn() }),
  useWallets: () => ({ wallets: [] }),
  useIdentityToken: () => ({ identityToken: undefined }),
  useLinkAccount: () => ({}),
}));

vi.mock("@/app/providers", () => ({
  useWebConfig: () => ({
    chainId: 11155111,
    multipass: WALLET,
    apiUrl: "http://api.test",
    parentNames: ["ketsuban.eth"],
    instances: [{ domain: "ketsuban", parentName: "ketsuban.eth", parentLabel: "ketsuban" }],
  }),
}));

vi.mock("@/app/AttestFlow", () => ({ AttestFlow: () => <div data-testid="signin-gate" /> }));

vi.mock("@/lib/hooks", () => ({
  apiFor: () => ({}),
  useWalletDashboard: () => ({ data: undefined, isPending: false }),
  useContracts: () => ({ data: undefined }),
  useLetterWrite: () => ({ write: vi.fn(), state: "idle" }),
}));

const { VouchFlow } = await import("@/app/vouch/[handle]/VouchFlow");

const invite = {
  handle: "peersky",
  voucher: "0x0000000000000000000000000000000000000000",
  exp: 1n,
  requires: ["github.com"],
  signature: "0x01",
} as never;

describe("the ask, read from the link", () => {
  it("says what the candidate asked for before the writer signs in", () => {
    render(<VouchFlow candidate="peersky" invite={invite} />);
    const said = screen.getByTestId("invite-preview").textContent ?? "";
    expect(said).toMatch(/github\.com/);
    // The privacy of it is the part a writer would not assume, so it is said here too.
    expect(said).toMatch(/masked account counts/);
  });

  it("says nothing when the link asks for nothing", () => {
    render(<VouchFlow candidate="peersky" />);
    expect(screen.queryByTestId("invite-preview")).toBeNull();
  });
});
