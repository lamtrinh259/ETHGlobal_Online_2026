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
const instance = (domain: string, parentName: string) => ({ domain, parentName, parentLabel: domain });
let instances = [
  instance("ketsuban", "ketsuban.eth"),
  instance("x.com", "com.x.www.ketsuban.eth"),
  instance("google.com", "com.google.www.ketsuban.eth"),
];
vi.mock("@/app/providers", () => ({ useWebConfig: () => ({ instances }) }));
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
  ensName: `alice_x.com.x.www.ketsuban.eth`,
  ...over,
});

describe("Accounts", () => {
  it("shows an attested account by its name, and a private one without", () => {
    render(
      <Accounts
        links={[link("x.com"), link("google.com", { optedIn: true, ensName: null })]}
        onPublished={vi.fn()}
      />
    );
    // A platform reads as the DNS name it is, so the account is `alice_x` on `x.com`.
    expect(screen.getByTestId("account-x")).toHaveTextContent("alice_x.com.x.www.ketsuban.eth");
    expect(screen.getByTestId("account-google")).toHaveTextContent("attested · private");
  });

  it("stops offering to attest an account that was just published, and says why", () => {
    // The record is on chain but the index has not listed it yet: the row must not read "not attested".
    render(<Accounts links={[]} awaiting="google.com" onPublished={vi.fn()} />);
    expect(screen.getByTestId("awaiting-google")).toHaveTextContent("waiting for the index");
    expect(screen.queryByTestId("attest-google")).toBeNull();
    // An account nothing is pending for still offers the action.
    expect(screen.getByTestId("attest-x")).toBeVisible();
  });

  it("says so when this deployment has no namespace for an account", () => {
    // Nobody deploys every mail host. Saying it here beats a revert after the person has signed.
    instances = [instance("ketsuban", "ketsuban.eth"), instance("x.com", "com.x.www.ketsuban.eth")];
    render(<Accounts links={[]} onPublished={vi.fn()} />);
    expect(screen.getByTestId("unmounted-google")).toHaveTextContent("no namespace here");
    expect(screen.queryByTestId("attest-google")).toBeNull();
    expect(screen.getByTestId("attest-x")).toBeVisible();
  });
});
