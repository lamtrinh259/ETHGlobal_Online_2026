import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
  useWebConfig: () => ({
    chainId: 11155111,
    multipass: WALLET,
    apiUrl: "http://api.test",
    parentNames: ["ketsuban.eth"],
  }),
}));

let existing: { code: string; requires: string[]; expiresAt: string }[] = [];
const api = {
  storeInvite: vi.fn(async () => ({ code: "abcd1234" })),
  invites: vi.fn(async (handle: string) => ({ handle, invites: existing })),
  // A real point on the curve, because the box is built with actual ECIES.
  enclaveKey: vi.fn(async () => ({
    publicKey:
      "0x0479be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8",
  })),
  disclose: vi.fn(async () => ({ id: "0xgrant", expiresAt: "2027-01-01T00:00:00.000Z" })),
} as unknown as Api;

vi.mock("@/lib/keys", () => ({
  loadViewCodes: () => ({ "discord.com": `0x${"22".repeat(32)}` }),
}));

const masked = [
  {
    domain: "discord.com",
    name: "",
    payload: "",
    validUntil: "2027-01-01T00:00:00.000Z",
    nonce: "1",
    live: true,
    optedIn: true,
    ensName: "alice.com.discord.private-www.ketsuban.eth",
  },
] as never;

const { InviteLink: Raw } = await import("@/app/me/InviteLink");

/** The component reads its own invitations, so every render needs a query client. */
const InviteLink = (props: Parameters<typeof Raw>[0]) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <Raw {...props} />
  </QueryClientProvider>
);

describe("inviting someone to refer you", () => {
  beforeEach(() => {
    existing = [];
    signed.length = 0;
    (api.storeInvite as ReturnType<typeof vi.fn>).mockClear();
  });

  it("keeps the choices behind the CTA, so the section is an offer rather than a form", () => {
    render(<InviteLink api={api} handle="alice" />);
    // Nothing to decide until someone says they want an invitation.
    expect(screen.queryByTestId("platform-linkedin.com")).toBeNull();
    expect(screen.queryByTestId("require-domain")).toBeNull();

    fireEvent.click(screen.getByTestId("open-invite"));
    expect(screen.getByTestId("platform-linkedin.com")).toBeInTheDocument();
    expect(screen.getByTestId("make-invite")).toBeInTheDocument();
  });

  it("makes a link short enough to send in a message", async () => {
    // A signed invitation encoded into the URL wraps in every chat client; the code stands for it.
    existing = [{ code: "abcd1234", requires: [], expiresAt: "2027-01-01T00:00:00.000Z" }];
    render(<InviteLink api={api} handle="alice" />);
    await waitFor(() => expect(screen.getByTestId("invite-abcd1234")).toBeInTheDocument());
    expect(screen.getByTestId("invite-abcd1234")).toHaveTextContent("abcd1234");
  });

  it("asks the writer for the accounts the candidate picked, and signs over them", async () => {
    render(<InviteLink api={api} handle="alice" />);
    fireEvent.click(screen.getByTestId("open-invite"));
    fireEvent.click(screen.getByTestId("platform-linkedin.com"));
    fireEvent.click(screen.getByTestId("make-invite"));

    await waitFor(() => expect(signed).toHaveLength(1));
    // The requirement is only worth anything because it is part of what was signed.
    expect(signed[0]).toMatchObject({ handle: "alice", requires: ["linkedin.com"] });
  });

  it("takes an email domain the candidate types, for a university or a workplace", async () => {
    render(<InviteLink api={api} handle="alice" />);
    fireEvent.click(screen.getByTestId("open-invite"));
    fireEvent.change(screen.getByTestId("require-domain"), { target: { value: "MIT.edu" } });
    fireEvent.click(screen.getByTestId("make-invite"));
    await waitFor(() => expect(signed).toHaveLength(1));
    // Lowercased, because a domain is a domain however it was typed.
    expect(signed[0]).toMatchObject({ requires: ["mit.edu"] });
  });

  it("will not sign an invitation nobody could satisfy", async () => {
    /*
     * A real one cost a real reference: `github.com, lamtrinh259`. The attester looks for a record the
     * writer holds in each named domain, and a username has none — so the writer followed the link,
     * vouched, and was told their reference was unsolicited, with nothing anywhere saying the
     * requirement had been impossible since the moment it was signed.
     */
    render(<InviteLink api={api} handle="alice" />);
    fireEvent.click(screen.getByTestId("open-invite"));
    fireEvent.change(screen.getByTestId("require-domain"), { target: { value: "lamtrinh259" } });

    // Said while it can still be changed, not after signing.
    expect(screen.getByTestId("require-domain-problem").textContent).toMatch(/username, not a domain/);

    fireEvent.click(screen.getByTestId("make-invite"));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/username, not a domain/));
    expect(signed, "an impossible invitation was signed anyway").toHaveLength(0);
  });

  it("marks a link already signed that nobody can satisfy, rather than offering it again", async () => {
    // Two of these were sent for real before the field was checked; the copy buttons are still here.
    existing = [
      { code: "8b4a1837", requires: ["github.com", "lamtrinh259"], expiresAt: "2027-01-01T00:00:00.000Z" },
      { code: "7e7944ba", requires: ["x.com"], expiresAt: "2027-01-01T00:00:00.000Z" },
    ];
    render(<InviteLink api={api} handle="alice" />);
    await waitFor(() => expect(screen.getByTestId("invite-8b4a1837")).toBeTruthy());
    expect(screen.getByTestId("invite-dead-8b4a1837").textContent).toMatch(/Nobody can satisfy this one/);
    expect(screen.queryByTestId("invite-dead-7e7944ba")).toBeNull();
    existing = [];
  });

  it("asks for nothing by default, which is the common case", async () => {
    render(<InviteLink api={api} handle="alice" />);
    fireEvent.click(screen.getByTestId("open-invite"));
    fireEvent.click(screen.getByTestId("make-invite"));
    await waitFor(() => expect(signed).toHaveLength(1));
    expect(signed[0]).toMatchObject({ requires: [] });
  });
});

describe("invitations already made", () => {
  beforeEach(() => {
    existing = [
      { code: "aaaa1111", requires: ["linkedin.com", "mit.edu"], expiresAt: "2027-01-01T00:00:00.000Z" },
    ];
  });

  it("lists them, so closing the page does not lose a link", async () => {
    // The link lived in component state; a reload lost it and the candidate had to sign another.
    render(<InviteLink api={api} handle="alice" />);
    await waitFor(() => expect(screen.getByTestId("invite-aaaa1111")).toBeInTheDocument());
    expect(screen.getByTestId("invite-aaaa1111")).toHaveTextContent("aaaa1111");
  });

  it("says what each one asks the writer to connect, so it can be checked before sending", async () => {
    render(<InviteLink api={api} handle="alice" />);
    await waitFor(() => expect(screen.getByTestId("invite-aaaa1111")).toBeInTheDocument());
    const row = screen.getByTestId("invite-aaaa1111");
    expect(row).toHaveTextContent("linkedin.com");
    expect(row).toHaveTextContent("mit.edu");
  });
});

/**
 * A writer who cannot see the private accounts is being asked to vouch for somebody half-visible.
 * The permission is a second statement — a separate signature — addressed exactly as far as the
 * invitation reaches.
 */
describe("opening private accounts to the writer", () => {
  beforeEach(() => {
    existing = [];
    signed.length = 0;
    (api.storeInvite as ReturnType<typeof vi.fn>).mockClear();
    (api.disclose as ReturnType<typeof vi.fn>).mockClear();
  });

  it("offers nothing to open when the holder has no private accounts", () => {
    render(<InviteLink api={api} handle="alice" name="alice.ketsuban.eth" links={[]} />);
    fireEvent.click(screen.getByTestId("open-invite"));
    expect(screen.queryByTestId("share-with-writer")).toBeNull();
  });

  it("signs a permission alongside the invitation, and only for what was picked", async () => {
    render(<InviteLink api={api} handle="alice" name="alice.ketsuban.eth" links={masked} />);
    fireEvent.click(screen.getByTestId("open-invite"));
    expect(screen.getByTestId("share-with-writer")).toBeInTheDocument();

    // Nothing is opened by accident: the invitation alone asks for no permission.
    fireEvent.click(screen.getByTestId("make-invite"));
    await waitFor(() => expect(api.storeInvite).toHaveBeenCalled());
    expect(api.disclose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("open-invite"));
    fireEvent.click(screen.getByRole("switch", { name: /discord\.com/ }));
    expect(screen.getByTestId("make-invite")).toHaveTextContent("Sign the link and the permission");
    fireEvent.click(screen.getByTestId("make-invite"));
    await waitFor(() => expect(api.disclose).toHaveBeenCalled());
    const wire = (api.disclose as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(wire.name).toBe("alice.ketsuban.eth");
    expect(wire.domains).toEqual(["discord.com"]);
    // As far as the link reaches, and no further: whoever holds it is who may already write.
    expect(wire.audience).toBe("0x0000000000000000000000000000000000000000");
    expect(wire.audienceName).toBe("");
  });
});
