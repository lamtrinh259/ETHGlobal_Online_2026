import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WalletDashboard } from "@/lib/api";

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ user: { google: { email: "tim@peeramid.xyz" }, twitter: { username: "peersky" } } }),
  useLinkAccount: () => ({
    linkTwitter: vi.fn(),
    linkTelegram: vi.fn(),
    linkGithub: vi.fn(),
    linkDiscord: vi.fn(),
    linkGoogle: vi.fn(),
  }),
}));
vi.mock("@/app/providers", () => ({
  useWebConfig: () => ({
    instances: [{ domain: "ketsuban", parentName: "ketsuban.eth", parentLabel: "ketsuban" }],
  }),
}));
vi.mock("@/app/AttestFlow", () => ({ AttestFlow: () => <div /> }));

const { Accounts } = await import("@/app/me/Accounts");

const link = (domain: string, over: Partial<WalletDashboard["links"][number]> = {}) => ({
  domain,
  name: "alice_x",
  payload: "",
  validUntil: "2027-01-01T00:00:00.000Z",
  nonce: "1",
  live: true,
  optedIn: false,
  ensName: `alice_x.${domain}.ketsuban.eth`,
  ...over,
});

describe("Accounts", () => {
  it("shows an attested account by its name, and a private one without", () => {
    render(
      <Accounts links={[link("x"), link("google", { optedIn: true, ensName: null })]} onPublished={vi.fn()} />
    );
    expect(screen.getByTestId("account-x")).toHaveTextContent("alice_x.x.ketsuban.eth");
    expect(screen.getByTestId("account-google")).toHaveTextContent("attested · private");
  });

  it("stops offering to attest an account that was just published, and says why", () => {
    // The record is on chain but the index has not listed it yet: the row must not read "not attested".
    render(<Accounts links={[]} awaiting="google" onPublished={vi.fn()} />);
    expect(screen.getByTestId("awaiting-google")).toHaveTextContent("waiting for the index");
    expect(screen.queryByTestId("attest-google")).toBeNull();
    // An account nothing is pending for still offers the action.
    expect(screen.getByTestId("attest-x")).toBeVisible();
  });
});
