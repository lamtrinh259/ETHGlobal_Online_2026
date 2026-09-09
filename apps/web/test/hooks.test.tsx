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
  useProfileWrite,
  useVerification,
  useVouches,
  useWalletDashboard,
} from "@/lib/hooks";
import * as chain from "@/lib/chain";

vi.mock("@/lib/chain", async (orig) => ({
  ...(await orig<typeof chain>()),
  writeProfileText: vi.fn(async () => "0xhash1"),
  linkOwnName: vi.fn(async () => "0xhash2"),
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
    nonce: vi.fn(async () => ({ exists: nonce > 1n, next: nonce })),
    attest: vi.fn(async () => result),
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
      balance: "0",
      gasTopup: { enabled: false, amount: "0", available: false },
      warning: "w",
    })),
    gas: vi.fn(async () => ({ hash: "0xhash3" as Hex, amount: "1" })),
    contracts: vi.fn(async () => ({ instances: [], bridge: WALLET, permissionedResolver: WALLET })),
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
    await waitFor(() => expect(r.current.n.data).toEqual({ exists: false, next: 1n }));
    expect(api.nonce).toHaveBeenCalledWith(WALLET, "x");

    await r.current.d.mutateAsync(result);
    await waitFor(() => expect(r.current.n.data).toEqual({ exists: true, next: 2n }));
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
