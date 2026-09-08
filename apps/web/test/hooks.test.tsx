import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { zeroHash, type Address } from "viem";
import type { Api, AttestResult } from "@/lib/api";
import { apiFor, useAttest, useDeliver, useNonce, useVerification } from "@/lib/hooks";
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
