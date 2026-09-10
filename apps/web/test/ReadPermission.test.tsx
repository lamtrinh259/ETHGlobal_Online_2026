import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Api, WalletDashboard } from "@/lib/api";

const WALLET = "0xEE4811b9462956C9C3535E79c08776D769CA9F3a";
const BOB = "0xd70B5E8A232Bf67F64658cbDDebe32e1443894a0";
const ZERO = "0x0000000000000000000000000000000000000000";

vi.mock("@privy-io/react-auth", () => ({
  useWallets: () => ({ wallets: [{ walletClientType: "privy", address: WALLET }] }),
  useSignTypedData: () => ({ signTypedData: vi.fn(async () => ({ signature: "0x01" })) }),
}));
vi.mock("@/app/providers", () => ({
  useWebConfig: () => ({
    chainId: 11155111,
    multipass: WALLET,
    apiUrl: "http://api.test",
    attestUrl: "http://api.test",
    instances: [{ domain: "ketsuban", parentName: "ketsuban.eth", parentLabel: "ketsuban" }],
  }),
}));

// The view code lives in the holder's browser and never leaves it; without one there is nothing to
// put in a box, and sharing refuses before it signs.
vi.mock("@/lib/keys", () => ({
  loadViewCodes: () => ({ "discord.com": `0x${"22".repeat(32)}`, "x.com": `0x${"33".repeat(32)}` }),
}));

const { ReadPermission, readerHandle } = await import("@/app/me/ReadPermission");

const link = (domain: string, ensName: string | null) => ({
  domain,
  name: "",
  payload: "",
  validUntil: "2027-01-01T00:00:00.000Z",
  nonce: "1",
  live: true,
  optedIn: true,
  ensName,
});

type Grant = {
  id: string;
  domains: string[];
  audience: string;
  audienceName: string;
  expiresAt: string;
};
let grants: Grant[] = [];
const revoke = vi.fn(async (wire: { grantId: string }) => {
  const gone = grants.find((g) => g.id === wire.grantId);
  grants = grants.filter((g) => g.id !== wire.grantId);
  return { ok: true as const, id: wire.grantId, domains: gone?.domains ?? [] };
});

const api = {
  nameStatus: vi.fn(async (_d: string, handle: string) => ({
    domain: "ketsuban",
    handle,
    taken: handle === "bob",
    wallet: handle === "bob" ? BOB : null,
    live: handle === "bob",
  })),
  reverse: vi.fn(async (address: string) => ({
    address,
    name: "bob.ketsuban.eth",
    names: [],
    primary: null,
  })),
  disclosures: vi.fn(async (name: string) => ({ name, grants })),
  // A full name is resolved by the resolver, which knows every namespace; the root lookup above knows
  // only one domain and could never answer for an account's own name.
  verify: vi.fn(async (name: string) => ({
    name,
    status: name === "lamtrinh259.com.github.www.ketsuban.eth" ? "active" : "inactive",
    wallet: name === "lamtrinh259.com.github.www.ketsuban.eth" ? BOB : null,
  })),
  // A real point on the curve — the generator — because the box is built with actual ECIES.
  enclaveKey: vi.fn(async () => ({
    publicKey:
      "0x0479be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8",
  })),
  disclose: vi.fn(async () => ({ id: "0xgrant", expiresAt: "2027-01-01T00:00:00.000Z" })),
  revoke,
} as unknown as Api;

const wrapper = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
};

const links = [link("discord.com", "alice.com.discord.private-www.ketsuban.eth")] as WalletDashboard["links"];

describe("sharing a private account", () => {
  beforeEach(() => {
    grants = [];
    revoke.mockClear();
  });

  it("reads a person's name the way people are named here", async () => {
    expect(readerHandle("bob.ketsuban.eth", "ketsuban.eth")).toBe("bob");
    expect(readerHandle("@Bob", "ketsuban.eth")).toBe("bob");
    expect(readerHandle("bob", "ketsuban.eth")).toBe("bob");
  });

  it("keeps the picker behind one CTA, so the page is a list of viewers rather than a form", () => {
    render(<ReadPermission api={api} links={links} name="alice.ketsuban.eth" />, { wrapper: wrapper() });
    // Nothing to fill in until the holder asks to add someone.
    expect(screen.queryByTestId("pick-list")).toBeNull();
    expect(screen.queryByTestId("share")).toBeNull();

    fireEvent.click(screen.getByTestId("add-viewer"));
    expect(screen.getByTestId("pick-list")).toBeInTheDocument();
    // Nothing is shared by accident: the button waits for a choice.
    expect(screen.getByTestId("share")).toBeDisabled();
    fireEvent.click(screen.getByTestId("pick-discord.com").querySelector("input") as HTMLInputElement);
    expect(screen.getByTestId("share")).toBeEnabled();
  });

  it("counts the accounts one link will open, so the reach of a share is visible before signing", () => {
    const two = [
      link("discord.com", "alice.com.discord.private-www.ketsuban.eth"),
      link("x.com", "alice.com.x.private-www.ketsuban.eth"),
    ] as WalletDashboard["links"];
    render(<ReadPermission api={api} links={two} name="alice.ketsuban.eth" />, { wrapper: wrapper() });
    fireEvent.click(screen.getByTestId("add-viewer"));
    fireEvent.click(screen.getByTestId("pick-discord.com").querySelector("input") as HTMLInputElement);
    expect(screen.getByTestId("share")).toHaveTextContent("Share");
    fireEvent.click(screen.getByTestId("pick-x.com").querySelector("input") as HTMLInputElement);
    expect(screen.getByTestId("share")).toHaveTextContent("Share 2 accounts");
  });

  it("names the person a permission is bound to, and says which wallet that is", async () => {
    render(<ReadPermission api={api} links={links} name="alice.ketsuban.eth" />, { wrapper: wrapper() });
    fireEvent.click(screen.getByTestId("add-viewer"));
    fireEvent.click(screen.getByTestId("pick-discord.com").querySelector("input") as HTMLInputElement);
    fireEvent.click(screen.getByTestId("scope-person"));
    expect(screen.getByTestId("share")).toBeDisabled();

    fireEvent.change(screen.getByTestId("reader"), { target: { value: "bob.ketsuban.eth" } });
    await waitFor(() =>
      expect(screen.getByTestId("reader-resolved")).toHaveTextContent("Only that wallet can open it")
    );
    expect(screen.getByTestId("share")).toBeEnabled();
  });

  /**
   * An account has a name of its own, and it does not live in the root instance: the root lookup asks
   * one domain and would answer "nobody holds it" for every one of them.
   */
  it("resolves an account's own name through the resolver, not through the root instance", async () => {
    render(<ReadPermission api={api} links={links} name="alice.ketsuban.eth" />, { wrapper: wrapper() });
    fireEvent.click(screen.getByTestId("add-viewer"));
    fireEvent.click(screen.getByTestId("pick-discord.com").querySelector("input") as HTMLInputElement);
    fireEvent.click(screen.getByTestId("scope-person"));
    fireEvent.change(screen.getByTestId("reader"), {
      target: { value: "lamtrinh259.com.github.www.ketsuban.eth" },
    });
    await waitFor(() =>
      expect(screen.getByTestId("reader-resolved")).toHaveTextContent("Only that wallet can open it")
    );
    expect(screen.getByTestId("share")).toBeEnabled();
  });

  /**
   * Nobody holding the name yet is not a dead end. A permission addressed to the name opens for
   * whoever proves on chain that they hold it, which is what lets somebody be invited before they
   * have arrived.
   */
  it("addresses a permission to a name nobody holds yet, so it opens when they claim it", async () => {
    render(<ReadPermission api={api} links={links} name="alice.ketsuban.eth" />, { wrapper: wrapper() });
    fireEvent.click(screen.getByTestId("add-viewer"));
    fireEvent.click(screen.getByTestId("pick-discord.com").querySelector("input") as HTMLInputElement);
    fireEvent.click(screen.getByTestId("scope-person"));
    fireEvent.change(screen.getByTestId("reader"), { target: { value: "nobody" } });
    await waitFor(() => expect(screen.getByTestId("reader-resolved")).toHaveTextContent("Nobody holds"));
    // The difference from a wallet is stated, because it is a real one.
    expect(screen.getByTestId("reader-resolved")).toHaveTextContent("A name can change hands");
    expect(screen.getByTestId("share")).toBeEnabled();

    fireEvent.click(screen.getByTestId("share"));
    await waitFor(() => {
      const err = screen.queryByRole("alert");
      expect(err?.textContent ?? "no error").toBe("no error");
      expect(api.disclose).toHaveBeenCalled();
    });
    const wire = (api.disclose as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // Addressed to the name itself, not to a wallet nobody has proved.
    expect(wire.audienceName).toBe("nobody.ketsuban.eth");
    expect(wire.audience).toBe(ZERO);
  });

  it("shares with a whole branch, which is a group the holder cannot list", async () => {
    // "Whoever at acme.com" is the case a wallet cannot express: ENSv2 answers for every name under
    // the branch, so the permission can name the branch instead of the people in it.
    render(<ReadPermission api={api} links={links} name="alice.ketsuban.eth" />, { wrapper: wrapper() });
    fireEvent.click(screen.getByTestId("add-viewer"));
    fireEvent.click(screen.getByTestId("pick-discord.com").querySelector("input") as HTMLInputElement);
    fireEvent.click(screen.getByTestId("scope-branch"));
    fireEvent.change(screen.getByTestId("branch"), { target: { value: "acme.com" } });

    // The branch is shown as the ENS name it really is, so nobody has to guess the mount order.
    expect(screen.getByTestId("branch-resolved")).toHaveTextContent("com.acme.www.ketsuban.eth");
    expect(screen.getByTestId("share")).toBeEnabled();
  });

  it("takes a wallet address without a lookup", async () => {
    render(<ReadPermission api={api} links={links} name="alice.ketsuban.eth" />, { wrapper: wrapper() });
    fireEvent.click(screen.getByTestId("add-viewer"));
    fireEvent.click(screen.getByTestId("scope-person"));
    fireEvent.change(screen.getByTestId("reader"), { target: { value: BOB } });
    expect(screen.getByTestId("reader-resolved")).toHaveTextContent("That wallet only");
  });
});

describe("permissions already given", () => {
  beforeEach(() => {
    revoke.mockClear();
    grants = [
      {
        id: `0x${"11".repeat(32)}`,
        domains: ["discord.com", "google"],
        audience: BOB,
        audienceName: "",
        expiresAt: "2027-03-01T00:00:00.000Z",
      },
      {
        id: `0x${"22".repeat(32)}`,
        domains: ["x.com"],
        audience: ZERO,
        audienceName: "",
        expiresAt: "2027-02-01T00:00:00.000Z",
      },
    ];
  });

  it("answers who can read what, naming the reader rather than showing a bare address", async () => {
    render(<ReadPermission api={api} links={links} name="alice.ketsuban.eth" />, { wrapper: wrapper() });
    const list = await screen.findByTestId("granted-list");
    // A permission for one reader and one for anybody are different facts and must not read alike.
    expect(list).toHaveTextContent("discord.com");
    expect(list).toHaveTextContent("x.com");
    expect(list).toHaveTextContent(/anyone with the link/i);
    // The reader is named, never left as a wallet: that is what having names is for.
    await waitFor(() => expect(list).toHaveTextContent("bob.ketsuban.eth"));
  });

  it("takes one share back with one signature, leaving the other standing", async () => {
    render(<ReadPermission api={api} links={links} name="alice.ketsuban.eth" />, { wrapper: wrapper() });
    await screen.findByTestId("granted-list");
    fireEvent.click(screen.getByTestId(`revoke-0x${"11".repeat(32)}`));

    await waitFor(() => expect(revoke).toHaveBeenCalledTimes(1));
    // One signature names the grant, not an account inside it.
    expect(revoke.mock.calls[0][0]).toMatchObject({
      name: "alice.ketsuban.eth",
      grantId: `0x${"11".repeat(32)}`,
    });
    await waitFor(() => expect(screen.queryByTestId(`revoke-0x${"11".repeat(32)}`)).toBeNull());
    expect(screen.getByTestId(`revoke-0x${"22".repeat(32)}`)).toBeInTheDocument();
  });

  it("says nothing is shared rather than showing an empty box", async () => {
    grants = [];
    render(<ReadPermission api={api} links={links} name="alice.ketsuban.eth" />, { wrapper: wrapper() });
    await waitFor(() => expect(screen.getByTestId("granted-none")).toHaveTextContent(/nobody/i));
  });
});
