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
vi.mock("@/app/providers", () => ({
  useWebConfig: () => ({ apiUrl: "http://api.test", attestUrl: "http://api.test" }),
}));
// The deployment's own mounts, which is what decides where an account is attested.
vi.mock("@/lib/hooks", () => ({
  apiFor: () => ({}),
  useContracts: () => ({ data: { instances } }),
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

  it("names a private account after the person, and still calls it private", () => {
    // The name says the holder of alice.ketsuban.eth is on Google. Which account it is stays masked.
    render(
      <Accounts
        links={[link("google.com", { optedIn: true, ensName: "alice.com.google.private-www.ketsuban.eth" })]}
        onPublished={vi.fn()}
      />
    );
    const row = screen.getByTestId("account-google");
    expect(row).toHaveTextContent("alice.com.google.private-www.ketsuban.eth");
    expect(row).toHaveTextContent("private");
    expect(row).not.toHaveTextContent("public");
  });

  it("still offers to attest into a namespace nobody has deployed yet", () => {
    // Nobody can deploy every mail host up front, so the relay mounts one during the attestation. The
    // row offers the action rather than turning the person away.
    instances = [instance("ketsuban", "ketsuban.eth")];
    render(<Accounts links={[]} onPublished={vi.fn()} />);
    expect(screen.getByTestId("attest-google")).toBeVisible();
    expect(screen.getByTestId("attest-x")).toBeVisible();
    expect(screen.queryByTestId("unmounted-google")).toBeNull();
  });
});
