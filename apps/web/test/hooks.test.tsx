import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { zeroHash, type Address, type Hex } from "viem";
import type { Api, AttestResult } from "@/lib/api";
import {
  apiFor,
  useAttest,
  useContracts,
  useDeliver,
  useGasTopup,
  useLetterWrite,
  useLinkOwnName,
  useNameStatus,
  useNonce,
  usePreflight,
  useProfileWrite,
  useReverse,
  useVerification,
  useVouches,
  useWalletDashboard,
} from "@/lib/hooks";
import * as chain from "@/lib/chain";

const claim = { readyAt: 0, commits: 0, registers: 0 };
vi.mock("@/lib/chain", async (orig) => ({
  ...(await orig<typeof chain>()),
  writeProfileText: vi.fn(async () => "0xhash1"),
  linkOwnName: vi.fn(async () => "0xhash2"),
  commitEthName: vi.fn(async () => {
    claim.commits += 1;
    return { readyAt: claim.readyAt };
  }),
  registerEthName: vi.fn(async () => {
    claim.registers += 1;
    return "0xhash3";
  }),
}));
import { loadWebConfig } from "@/lib/config";

const WALLET: Address = "0xEE4811b9462956C9C3535E79c08776D769CA9F3a";
const result: AttestResult = {
  record: {
    name: zeroHash,
    id: zeroHash,
    domainName: zeroHash,
    validUntil: "1",
    nonce: "1",
    wallet: WALLET,
    payload: zeroHash,
  },
  signature: "0x01",
  viewCode: null,
};

function fakeApi(): Api {
  let nonce = 1n;
  return {
    nonce: vi.fn(async () => ({ exists: nonce > 1n, next: nonce, ready: true, reason: null })),
    attest: vi.fn(async () => result),
    uploadAvatar: vi.fn(async () => ({ id: "a.png", url: "https://api.test/v1/avatar/a.png" })),
    find: vi.fn(async (q: string) => ({ q, matches: [] })),
    storeInvite: vi.fn(async () => ({ code: "abcd1234" })),
    instance: vi.fn(async (domain: string) => ({
      domain,
      parentName: `${domain}.ketsuban.eth`,
      description: null,
      answers: [],
    })),
    invite: vi.fn(async (code: string) => ({ code, invite: {} })),
    storeLetter: vi.fn(async (text: string) => ({
      hash: "a".repeat(64),
      ref: `sha256:${"a".repeat(64)}`,
      bytes: text.length,
    })),
    who: vi.fn(async (domain: string, handle: string) => ({ found: false, domain, handle })),
    disclosures: vi.fn(async (name: string) => ({ name, grants: [] })),
    revoke: vi.fn(async () => ({ ok: true as const, id: `0x${"11".repeat(32)}`, domains: ["x"] })),
    explain: vi.fn(async (name: string) => ({ name, says: "", kind: "unknown" as const })),
    ethLabel: vi.fn(async (label: string) => ({
      label,
      registry: WALLET,
      owner: label === "alice" ? WALLET : null,
    })),
    deliver: vi.fn(async () => {
      nonce += 1n;
      return { ok: true as const, txHash: `0x${"ab".repeat(32)}` as `0x${string}` };
    }),
    vouches: vi.fn(async (handle: string) => ({ handle, domain: `~${handle}`, vouches: [], warning: "w" })),
    profile: vi.fn(async (handle: string) => ({
      handle,
      names: [],
      vouches: [],
      standing: { claimed: true, given: 0, received: 0 },
      warning: "w",
    })),
    nameStatus: vi.fn(async (domain: string, handle: string) => ({
      domain,
      handle,
      taken: handle === "taken",
      wallet: handle === "taken" ? WALLET : null,
      live: handle === "taken",
    })),
    wallet: vi.fn(async (address: string) => ({
      address,
      names: [],
      links: [],
      given: [],
      org: null,
      balance: "0",
      gasTopup: { enabled: false, amount: "0", available: false },
      warning: "w",
    })),
    gas: vi.fn(async () => ({ hash: "0xhash3" as Hex, amount: "1" })),
    contracts: vi.fn(async () => ({ instances: [], bridge: WALLET, permissionedResolver: WALLET })),
    enclaveKey: vi.fn(async () => ({ address: WALLET, publicKey: `0x04${"11".repeat(64)}` as Hex })),
    disclose: vi.fn(async () => ({
      ok: true as const,
      id: `0x${"11".repeat(32)}` as `0x${string}`,
      domains: ["x"],
      expiresAt: "2027-01-01T00:00:00.000Z",
    })),
    disclosed: vi.fn(async (name: string, domain: string) => ({
      name,
      domain,
      disclosed: { handle: "alice_x", platformId: "1" },
      warning: "w",
    })),
    reverse: vi.fn(async (address: string) => ({
      address,
      name: "alice.ketsuban.eth",
      names: [{ domain: "ketsuban", name: "alice.ketsuban.eth", resolver: WALLET }],
      note: "answered from the Multipass record, not from a reverse registry",
    })),
    preflight: vi.fn(async () => ({
      ok: false,
      warnings: ['domain "google" is not initialised on Multipass'],
    })),
    ens: vi.fn(async (name: string, keys?: string[]) => ({
      name,
      universalResolver: WALLET,
      resolver: WALLET,
      addr: WALLET,
      texts: Object.fromEntries((keys ?? []).map((k) => [k, "v"])),
      status: "active" as const,
      warning: "w",
    })),
    verify: vi.fn(async (name: string) => ({
      name,
      instance: { domain: "ketsuban", parentName: "ketsuban.eth" },
      status: "inactive" as const,
      wallet: null,
      answer: null,
      expiresAt: null,
      humanity: null,
      links: [],
      evidence: ["wallet_binding"],
      decision: "no_record",
      warning: "w",
    })),
  };
}

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe("hooks", () => {
  it("useNonce waits for a wallet, then reads; delivery invalidates it", async () => {
    const api = fakeApi();
    const w = wrapper();
    const { result: r, rerender } = renderHook(
      ({ wallet }: { wallet?: Address }) => ({
        n: useNonce(api, wallet, "x"),
        d: useDeliver(api, wallet, "x"),
      }),
      {
        wrapper: w,
        initialProps: { wallet: undefined as Address | undefined },
      }
    );
    expect(r.current.n.fetchStatus).toBe("idle");
    expect(api.nonce).not.toHaveBeenCalled();

    rerender({ wallet: WALLET });
    await waitFor(() => expect(r.current.n.data).toMatchObject({ exists: false, next: 1n }));
    expect(api.nonce).toHaveBeenCalledWith(WALLET, "x");

    await r.current.d.mutateAsync(result);
    await waitFor(() => expect(r.current.n.data).toMatchObject({ exists: true, next: 2n }));
    expect(api.deliver).toHaveBeenCalledWith(result);
  });

  it("useAttest posts the wire and exposes the result", async () => {
    const api = fakeApi();
    const { result: r } = renderHook(() => useAttest(api), { wrapper: wrapper() });
    await r.current.mutateAsync({ a: 1 });
    await waitFor(() => expect(r.current.data).toEqual(result));
    expect(api.attest).toHaveBeenCalledWith({ a: 1 });
  });

  it("useVerification keys by name, links and view code", async () => {
    const api = fakeApi();
    const { result: r } = renderHook(
      () => useVerification(api, "a.ketsuban.eth", { links: ["x"], viewCode: "0x02" }),
      { wrapper: wrapper() }
    );
    await waitFor(() => expect(r.current.data?.name).toBe("a.ketsuban.eth"));
    expect(api.verify).toHaveBeenCalledWith("a.ketsuban.eth", { links: ["x"], viewCode: "0x02" });
    const off = renderHook(() => useVerification(api, ""), { wrapper: wrapper() });
    expect(off.result.current.fetchStatus).toBe("idle");
  });

  it("useNameStatus only asks for well-formed handles; useWalletDashboard waits for a wallet", async () => {
    const api = fakeApi();
    const bad = renderHook(() => useNameStatus(api, "ketsuban", "Bad Name"), { wrapper: wrapper() });
    expect(bad.result.current.fetchStatus).toBe("idle");
    const ok = renderHook(() => useNameStatus(api, "ketsuban", "taken"), { wrapper: wrapper() });
    await waitFor(() => expect(ok.result.current.data?.taken).toBe(true));
    expect(api.nameStatus).toHaveBeenCalledWith("ketsuban", "taken");
    const off = renderHook(() => useNameStatus(api, "ketsuban", "free", false), { wrapper: wrapper() });
    expect(off.result.current.fetchStatus).toBe("idle");

    const noHandle = renderHook(() => useVouches(api, undefined), { wrapper: wrapper() });
    expect(noHandle.result.current.fetchStatus).toBe("idle");
    const vouches = renderHook(() => useVouches(api, "alice"), { wrapper: wrapper() });
    await waitFor(() => expect(vouches.result.current.data?.handle).toBe("alice"));

    const rev = renderHook(() => useReverse(api, WALLET), { wrapper: wrapper() });
    await waitFor(() => expect(rev.result.current.data?.name).toBe("alice.ketsuban.eth"));
    expect(
      renderHook(() => useReverse(api, undefined), { wrapper: wrapper() }).result.current.fetchStatus
    ).toBe("idle");

    const pre = renderHook(() => usePreflight(api), { wrapper: wrapper() });
    await waitFor(() => expect(pre.result.current.data?.warnings).toHaveLength(1));
    expect(pre.result.current.data?.ok).toBe(false);

    // Polling only while a record is expected, so the page settles instead of hammering the API.
    const idle = renderHook(() => useWalletDashboard(api, WALLET), { wrapper: wrapper() });
    await waitFor(() => expect(idle.result.current.data?.address).toBe(WALLET));
    const calls = (api.wallet as ReturnType<typeof vi.fn>).mock.calls.length;
    await new Promise((r) => setTimeout(r, 60));
    expect((api.wallet as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls);

    const noWallet = renderHook(() => useWalletDashboard(api, undefined), { wrapper: wrapper() });
    expect(noWallet.result.current.fetchStatus).toBe("idle");
    const dash = renderHook(() => useWalletDashboard(api, WALLET), { wrapper: wrapper() });
    await waitFor(() => expect(dash.result.current.data?.address).toBe(WALLET));
  });

  it("useContracts caches addresses; profile write sends one tx per changed key and refreshes the card", async () => {
    const api = fakeApi();
    const w = wrapper();
    const contracts = renderHook(() => useContracts(api), { wrapper: w });
    await waitFor(() => expect(contracts.result.current.data?.bridge).toBe(WALLET));

    const signer = { provider: {} as never, account: WALLET, chainId: 31337 };
    const write = renderHook(() => useProfileWrite("alice.ketsuban.eth"), { wrapper: w });
    write.result.current.mutate({ signer, resolver: WALLET, changes: { url: "https://a", email: "a@b" } });
    await waitFor(() => expect(write.result.current.data).toEqual(["0xhash1", "0xhash1"]));
    expect(chain.writeProfileText).toHaveBeenCalledWith(
      signer,
      WALLET,
      "alice.ketsuban.eth",
      "url",
      "https://a"
    );
    expect(chain.writeProfileText).toHaveBeenCalledWith(signer, WALLET, "alice.ketsuban.eth", "email", "a@b");

    const gas = renderHook(() => useGasTopup(WALLET), { wrapper: w });
    gas.result.current.mutate(api);
    await waitFor(() => expect(gas.result.current.data?.hash).toBe("0xhash3"));
    expect(api.gas).toHaveBeenCalledWith(WALLET);

    const letter = renderHook(() => useLetterWrite("alice"), { wrapper: w });
    letter.result.current.mutate({
      signer,
      resolver: WALLET,
      name: "bob.alice.ketsuban.eth",
      letter: "long text",
    });
    await waitFor(() => expect(letter.result.current.data).toBe("0xhash1"));
    expect(chain.writeProfileText).toHaveBeenCalledWith(
      signer,
      WALLET,
      "bob.alice.ketsuban.eth",
      "description",
      "long text"
    );

    const link = renderHook(() => useLinkOwnName(WALLET), { wrapper: w });
    link.result.current.mutate({ signer, bridge: WALLET, domain: "ketsuban", label: "alice" });
    await waitFor(() => expect(link.result.current.data).toBe("0xhash2"));
    expect(chain.linkOwnName).toHaveBeenCalledWith(signer, WALLET, "ketsuban", "alice");
  });

  it("useEthLabel only asks about a label that could be a name", async () => {
    // A lookup for every keystroke would ask about "a" and "al"; the registrar's own minimum is three.
    const { useEthLabel } = await import("@/lib/hooks");
    const client = fakeApi();
    const { result: hook, rerender } = renderHook(
      ({ label }: { label: string }) => useEthLabel(client, label),
      {
        wrapper: wrapper(),
        initialProps: { label: "ab" },
      }
    );
    expect(client.ethLabel).not.toHaveBeenCalled();
    rerender({ label: "alice" });
    await waitFor(() => expect(hook.current.data?.label).toBe("alice"));
    expect(client.ethLabel).toHaveBeenCalledWith("alice");
  });

  it("useClaimEthName waits out the registrar's window, then registers", async () => {
    // The registrar makes this two signatures a minute apart; the hook shows the wait rather than
    // appearing to hang, and registers only once it has passed.
    const { useClaimEthName } = await import("@/lib/hooks");
    claim.commits = 0;
    claim.registers = 0;
    claim.readyAt = Math.floor(Date.now() / 1000) + 2;
    const done = vi.fn();
    const { result: hook } = renderHook(() => useClaimEthName(done), { wrapper: wrapper() });
    const params = {
      registrar: WALLET,
      token: WALLET,
      resolver: WALLET,
      label: "alice-test",
      owner: WALLET,
      duration: 1n,
    };
    hook.current.mutate({ signer: {} as never, params });

    await waitFor(() => expect(hook.current.waitingUntil).toBeTruthy(), { timeout: 2000 });
    expect(claim.registers).toBe(0);
    await waitFor(() => expect(done).toHaveBeenCalled(), { timeout: 6000 });
    expect(claim.commits).toBe(1);
    expect(claim.registers).toBe(1);
    expect(hook.current.waitingUntil).toBeUndefined();
  });

  it("useClaimEthName stops showing a wait when the wallet refuses", async () => {
    const { useClaimEthName } = await import("@/lib/hooks");
    const chainMod = await import("@/lib/chain");
    vi.mocked(chainMod.registerEthName).mockRejectedValueOnce(new Error("user rejected"));
    claim.readyAt = 0;
    const { result: hook } = renderHook(() => useClaimEthName(vi.fn()), { wrapper: wrapper() });
    hook.current.mutate({
      signer: {} as never,
      params: {
        registrar: WALLET,
        token: WALLET,
        resolver: WALLET,
        label: "alice-test",
        owner: WALLET,
        duration: 1n,
      },
    });
    await waitFor(() => expect(hook.current.error?.message).toBe("user rejected"));
    expect(hook.current.waitingUntil).toBeUndefined();
  });

  it("apiFor builds a client from config", () => {
    const api = apiFor(
      loadWebConfig({
        NEXT_PUBLIC_PRIVY_APP_ID: "a",
        NEXT_PUBLIC_PRIVY_CLIENT_ID: "c",
        NEXT_PUBLIC_API_URL: "http://api.test",
        NEXT_PUBLIC_ATTEST_URL: "http://api.test/v1/attest",
        NEXT_PUBLIC_CHAIN_ID: "1",
        NEXT_PUBLIC_MULTIPASS: "0x418F82fd0014a4CA402F145978bfaF0555a9cA06",
        NEXT_PUBLIC_NAME_DOMAINS: "k",
        NEXT_PUBLIC_PARENT_NAMES: "k.eth",
      })
    );
    expect(typeof api.verify).toBe("function");
  });
});
