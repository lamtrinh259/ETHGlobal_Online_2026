import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WalletDashboard } from "@/lib/api";

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ user: { google: { email: "tim@peeramid.xyz" }, twitter: { username: "peersky" } } }),
  useLinkAccount: () => ({
    linkTwitter: () => linked.push("x"),
    linkTelegram: () => linked.push("telegram"),
    linkGithub: () => linked.push("github"),
    linkDiscord: () => linked.push("discord"),
    linkGoogle: () => linked.push("google"),
  }),
}));
const linked: string[] = [];
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
    // Private, and with no name of its own yet: the badge carries the state either way.
    expect(screen.getByTestId("badge-google.com")).toHaveTextContent("private");
  });

  it("stops offering to attest an account that was just published, and says why", () => {
    // The record is on chain but the index has not listed it yet: the row must not read "not attested".
    render(<Accounts links={[]} awaiting="google.com" onPublished={vi.fn()} />);
    expect(screen.getByTestId("awaiting-google")).toHaveTextContent("waiting for the index");
    expect(screen.queryByTestId("attest-google")).toBeNull();
    // An account nothing is pending for still offers the action.
    expect(screen.getByTestId("attest-x")).toBeVisible();
  });

  it("shows a private account's state as a badge and its platform as a mark", () => {
    // The row used to run "private" straight into the next link with no separator. State is a badge,
    // identity is an icon, and neither is a run of text that collides with the other.
    render(
      <Accounts
        links={[link("google.com", { optedIn: true, ensName: "alice.com.google.private-www.ketsuban.eth" })]}
        handle="alice"
        onPublished={() => {}}
      />
    );
    const row = screen.getByTestId("account-google");
    expect(row.querySelector('[data-testid="icon-google.com"]')).not.toBeNull();
    expect(screen.getByTestId("badge-google.com")).toHaveTextContent("private");
  });

  it("calls a public account public, in the same place the private badge sits", () => {
    render(<Accounts links={[link("x.com")]} handle="alice" onPublished={() => {}} />);
    expect(screen.getByTestId("badge-x.com")).toHaveTextContent("public");
  });

  it("points a private account at the controls that say who can read it", () => {
    // Sharing lives further down the page; without a way in from the row, a private account looks like
    // a dead end rather than something the person decides who may open.
    render(
      <Accounts
        links={[link("google.com", { optedIn: true, ensName: "alice.com.google.private-www.ketsuban.eth" })]}
        handle="alice"
        onPublished={() => {}}
      />
    );
    const who = screen.getByTestId("who-reads-google.com");
    expect(who).toHaveAttribute("href", "#sharing");
    expect(who).toHaveTextContent(/who can read it/i);
  });

  it("offers no reader controls for a public account, which has nothing to open", () => {
    render(<Accounts links={[link("x.com")]} handle="alice" onPublished={() => {}} />);
    expect(screen.queryByTestId("who-reads-x.com")).toBeNull();
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

  it("shows an account attested before the DNS namespace existed", () => {
    // The record is in the flat `google` domain. Calling it unattested while the rest of the page lists
    // it is the contradiction a person would notice first.
    instances = [instance("ketsuban", "ketsuban.eth"), instance("google", "google.ketsuban.eth")];
    render(
      <Accounts
        links={[link("google", { optedIn: true, ensName: null })]}
        handle="alice"
        onPublished={vi.fn()}
      />
    );
    expect(screen.getByTestId("badge-google")).toHaveTextContent("private");
    expect(screen.queryByTestId("attest-google")).toBeNull();
  });

  it("offers a name to an account attested before the namespace existed", () => {
    // The flat record stands and stays private; attesting again under `google.com` is what names it.
    instances = [
      instance("ketsuban", "ketsuban.eth"),
      instance("google", "google.ketsuban.eth"),
      instance("google.com", "com.google.www.ketsuban.eth"),
    ];
    render(
      <Accounts
        links={[link("google", { optedIn: true, ensName: null })]}
        handle="alice"
        onPublished={vi.fn()}
      />
    );
    expect(screen.getByTestId("badge-google")).toHaveTextContent("private");
    expect(screen.getByTestId("rename-google")).toHaveTextContent("give it a name");
  });

  it("says a private account gets its name once the person claims one", () => {
    // The private branch names an account after its holder, so without a handle there is nothing to
    // name it after. Saying that beats a bare "private" the person cannot act on.
    render(<Accounts links={[link("google.com", { optedIn: true, ensName: null })]} onPublished={vi.fn()} />);
    expect(screen.getByTestId("account-google")).toHaveTextContent("claim your name below");
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

describe("connecting another account", () => {
  it("opens a chooser rather than a row of bare buttons, and lists what is not connected yet", () => {
    // Five connectors inline wrapped into the row above and read as part of the last account.
    render(<Accounts links={[link("x.com")]} handle="alice" onPublished={() => {}} />);
    expect(screen.queryByTestId("connect-github")).toBeNull();

    fireEvent.click(screen.getByTestId("add-account"));
    const chooser = screen.getByTestId("connect-list");
    expect(chooser).toHaveTextContent("GitHub");
    expect(chooser).toHaveTextContent("Telegram");
    expect(chooser).toHaveTextContent("Discord");
    // X and Google are already linked in this fixture: offering them again is offering a no-op.
    expect(screen.queryByTestId("connect-x")).toBeNull();
    expect(screen.queryByTestId("connect-google")).toBeNull();
  });

  it("asks Privy for the platform that was picked", () => {
    render(<Accounts links={[]} handle="alice" onPublished={() => {}} />);
    fireEvent.click(screen.getByTestId("add-account"));
    fireEvent.click(screen.getByTestId("connect-github"));
    expect(linked).toContain("github");
  });
});
