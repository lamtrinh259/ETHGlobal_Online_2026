import { describe, expect, it, vi } from "vitest";
import { bytesToHex, recoverTypedDataAddress, stringToBytes, zeroHash, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { eciesEncrypt, recoverIntentSigner, intentDomain } from "@ketsuban/registrar";
import { toBytes32 } from "@peeramid-labs/multipass-client";
import { ApiError, createApi } from "@/lib/api";
import { loadWebConfig } from "@/lib/config";
import { buildIntent, intentTypedData, toWire } from "@/lib/intent";
import { fromPrivateKey, loadOrCreateViewKey, loadViewCodes, openViewCode, saveViewCode } from "@/lib/keys";

const env = {
  NEXT_PUBLIC_PRIVY_APP_ID: "app",
  NEXT_PUBLIC_PRIVY_CLIENT_ID: "client",
  NEXT_PUBLIC_API_URL: "http://api.test",
  NEXT_PUBLIC_ATTEST_URL: "http://api.test/v1/attest",
  NEXT_PUBLIC_CHAIN_ID: "11155111",
  NEXT_PUBLIC_MULTIPASS: "0x418F82fd0014a4CA402F145978bfaF0555a9cA06",
  NEXT_PUBLIC_NAME_DOMAINS: "ketsuban, kju-is",
  NEXT_PUBLIC_PARENT_NAMES: "ketsuban.eth,kju-is.ketsuban.eth",
};
const NOW = 1_800_000_000;
const account = privateKeyToAccount("0x000000000000000000000000000000000000000000000000000000000000a11c");

describe("view codes", () => {
  it("keeps opened view codes per domain and survives garbage in storage", () => {
    const mem: Record<string, string> = {};
    const storage = {
      getItem: (k: string) => mem[k] ?? null,
      setItem: (k: string, v: string) => void (mem[k] = v),
    };
    expect(loadViewCodes(storage)).toEqual({});
    saveViewCode("x", "0xaa", storage);
    saveViewCode("github", "0xbb", storage);
    expect(loadViewCodes(storage)).toEqual({ x: "0xaa", github: "0xbb" });
    mem["ketsuban:viewcodes"] = JSON.stringify({ x: "0xaa", bad: 1, worse: "nope" });
    expect(loadViewCodes(storage)).toEqual({ x: "0xaa" });
    mem["ketsuban:viewcodes"] = "{not json";
    expect(loadViewCodes(storage)).toEqual({});
    const throwing = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(loadViewCodes(throwing)).toEqual({});
    expect(() => saveViewCode("x", "0xaa", throwing)).not.toThrow();
  });
});

describe("config", () => {
  it("pairs name domains with parent names", () => {
    const c = loadWebConfig(env);
    expect(c.instances).toEqual([
      { domain: "ketsuban", parentName: "ketsuban.eth", parentLabel: "ketsuban" },
      { domain: "kju-is", parentName: "kju-is.ketsuban.eth", parentLabel: "kju-is" },
    ]);
    expect(c.chainId).toBe(11155111);
  });
  it("rejects mismatched lists and missing values", () => {
    expect(() => loadWebConfig({ ...env, NEXT_PUBLIC_PARENT_NAMES: "ketsuban.eth" })).toThrow("same length");
    expect(() => loadWebConfig({ ...env, NEXT_PUBLIC_API_URL: "" })).toThrow();
  });
});

describe("intent", () => {
  const base = {
    wallet: account.address,
    nonce: 3n,
    now: NOW,
    optIn: false,
    pubkey: account.publicKey,
  };

  it("builds a name-domain intent the registrar accepts, signed by the wallet", async () => {
    const intent = buildIntent({
      ...base,
      domain: "ketsuban",
      handle: "alice",
      answer: "terrible dictator",
      isNameDomain: true,
    });
    expect(intent).toEqual({
      wallet: account.address,
      domain: "ketsuban",
      nonce: 3n,
      exp: BigInt(NOW + 600),
      optIn: false,
      pubkey: account.publicKey,
      handle: "alice",
      payload: toBytes32("terrible dictator"),
    });
    const td = intentTypedData(intent, 11155111, "0x418F82fd0014a4CA402F145978bfaF0555a9cA06");
    const signature = await account.signTypedData(td);
    expect(
      await recoverIntentSigner(intent, signature, intentDomain(11155111, td.domain.verifyingContract!))
    ).toBe(account.address);
    expect(await recoverTypedDataAddress({ ...td, signature })).toBe(account.address);
  });

  it("builds a platform intent with empty handle/payload and honours ttl", () => {
    const intent = buildIntent({ ...base, domain: "x", optIn: true, isNameDomain: false, ttlSeconds: 60 });
    expect(intent.handle).toBe("");
    expect(intent.payload).toBe(zeroHash);
    expect(intent.optIn).toBe(true);
    expect(intent.exp).toBe(BigInt(NOW + 60));
  });

  it("rejects bad handles and opt-in on name domains", () => {
    expect(() => buildIntent({ ...base, domain: "ketsuban", handle: "Al ice", isNameDomain: true })).toThrow(
      "handle"
    );
    expect(() =>
      buildIntent({ ...base, domain: "ketsuban", handle: "alice", optIn: true, isNameDomain: true })
    ).toThrow("opt-in");
  });

  it("serialises bigints for the wire", () => {
    const intent = buildIntent({ ...base, domain: "x", isNameDomain: false });
    expect(toWire(intent, "tok", "0x01")).toEqual({
      idToken: "tok",
      signature: "0x01",
      intent: { ...intent, nonce: "3", exp: String(NOW + 600) },
    });
  });
});

describe("keys", () => {
  it("creates once, reloads the same key, and opens a box encrypted to it", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    const a = loadOrCreateViewKey(storage);
    const b = loadOrCreateViewKey(storage);
    expect(b).toEqual(a);
    expect(a.publicKey).toMatch(/^0x0[23][0-9a-f]{64}$/);

    const secret = stringToBytes("view-code");
    const box = eciesEncrypt(a.publicKey, secret, new Uint8Array(32).fill(9));
    expect(openViewCode(a, box)).toBe(bytesToHex(secret));
    expect(fromPrivateKey(a.privateKey)).toEqual(a);
  });

  it("replaces a corrupt stored key", () => {
    const store = new Map<string, string>([["ketsuban:viewcode-key", "garbage"]]);
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    const k = loadOrCreateViewKey(storage);
    expect(store.get("ketsuban:viewcode-key")).toBe(k.privateKey);
  });
});

describe("api client", () => {
  const result = {
    record: {
      name: toBytes32("alice"),
      id: toBytes32("1"),
      domainName: toBytes32("x"),
      validUntil: "1",
      nonce: "1",
      wallet: account.address,
      payload: zeroHash,
    },
    signature: "0x01" as Hex,
    viewCode: null,
  };
  const verification = {
    name: "alice.ketsuban.eth",
    instance: { domain: "ketsuban", parentName: "ketsuban.eth" },
    status: "active",
    wallet: account.address,
    answer: "terrible dictator",
    expiresAt: "2026-10-08T09:14:22.000Z",
    humanity: null,
    links: [{ domain: "x", optedIn: true, commitment: "0x01" }],
    evidence: ["wallet_binding", "x_account_control"],
    decision: "additional_context_available",
    warning: "w",
  };

  function fetchMock(routes: Record<string, { status?: number; body: unknown }>) {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fn = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const hit = Object.entries(routes).find(([k]) => url.startsWith(k));
      if (!hit) return new Response("null", { status: 404 });
      return new Response(JSON.stringify(hit[1].body), {
        status: hit[1].status ?? 200,
        headers: { "content-type": "application/json" },
      });
    });
    return { fn: fn as unknown as typeof fetch, calls };
  }

  it("reads nonce, attests, delivers and verifies with the right URLs and bodies", async () => {
    const { fn, calls } = fetchMock({
      "http://api.test/v1/nonce": { body: { exists: true, nonce: "2", next: "3" } },
      "http://api.test/v1/attest": { body: result },
      "http://api.test/v1/cre/delivery": { body: { ok: true, txHash: `0x${"ab".repeat(32)}` } },
      "http://api.test/v1/verify/alice.ketsuban.eth": { body: verification },
      "http://api.test/v1/instances": {
        body: {
          instances: [
            {
              domain: "ketsuban",
              registry: account.address,
              resolver: account.address,
              parentName: "ketsuban.eth",
              parentLabel: "ketsuban",
            },
          ],
          bridge: account.address,
          permissionedResolver: null,
        },
      },
      "http://api.test/v1/name/ketsuban/alice": {
        body: { domain: "ketsuban", handle: "alice", taken: true, wallet: account.address, live: true },
      },
      [`http://api.test/v1/wallet/${account.address}`]: {
        body: {
          address: account.address,
          names: [
            {
              domain: "ketsuban",
              name: "alice",
              payload: "",
              validUntil: "2027-01-01T00:00:00.000Z",
              nonce: "1",
              live: true,
              ensName: "alice.ketsuban.eth",
            },
          ],
          links: [],
          given: [],
          balance: "0",
          gasTopup: { enabled: true, amount: "2000000000000000", available: true },
          warning: "w",
        },
      },
      "http://api.test/v1/gas": {
        body: { hash: `0x${"cc".repeat(32)}`, amount: "2000000000000000" },
      },
      "http://api.test/v1/vouches/alice": {
        body: {
          handle: "alice",
          domain: "~alice",
          warning: "w",
          vouches: [
            {
              voucher: "bob",
              voucherName: "bob.ketsuban.eth",
              wallet: "0x1",
              statement: "s",
              validUntil: "2027-01-01T00:00:00.000Z",
              nonce: "1",
              live: true,
            },
          ],
        },
      },
    });
    const api = createApi("http://api.test/", "http://api.test/v1/attest", fn);

    expect(await api.nonce(account.address, "x")).toEqual({ exists: true, next: 3n });
    expect(calls[0].url).toBe(`http://api.test/v1/nonce?wallet=${account.address}&domain=x`);

    expect(await api.attest({ a: 1 })).toEqual(result);
    expect(calls[1].init?.method).toBe("POST");
    expect(JSON.parse(calls[1].init?.body as string)).toEqual({ a: 1 });

    expect(await api.deliver(result, "tok")).toEqual({ ok: true, txHash: `0x${"ab".repeat(32)}` });
    expect((calls[2].init?.headers as Record<string, string>)["x-delivery-token"]).toBe("tok");

    expect(await api.verify("alice.ketsuban.eth", { links: ["x"], viewCode: "0x02" })).toEqual(verification);
    expect((await api.vouches("alice")).vouches[0].voucher).toBe("bob");
    expect((await api.contracts()).bridge).toBe(account.address);
    expect((await api.contracts()).permissionedResolver).toBeNull();
    expect(await api.nameStatus("ketsuban", "alice")).toEqual({
      domain: "ketsuban",
      handle: "alice",
      taken: true,
      wallet: account.address,
      live: true,
    });
    const dash = await api.wallet(account.address);
    expect(dash.names[0].ensName).toBe("alice.ketsuban.eth");
    expect(dash.gasTopup).toEqual({ enabled: true, amount: "2000000000000000", available: true });
    expect(await api.gas(account.address)).toEqual({
      hash: `0x${"cc".repeat(32)}`,
      amount: "2000000000000000",
    });
    expect(calls[3].url).toBe("http://api.test/v1/verify/alice.ketsuban.eth?links=x&viewCode=0x02");
  });

  it("surfaces API errors with status and message and rejects malformed payloads", async () => {
    const { fn } = fetchMock({
      "http://api.test/v1/attest": { status: 422, body: { error: "intent: expired" } },
      "http://api.test/v1/verify/x": { body: { nope: 1 } },
    });
    const api = createApi("http://api.test", "http://api.test/v1/attest", fn);
    await expect(api.attest({})).rejects.toMatchObject({
      status: 422,
      message: "intent: expired",
    } satisfies Partial<ApiError>);
    await expect(api.verify("x")).rejects.toThrow();
    await expect(api.nonce(account.address, "x")).rejects.toMatchObject({ status: 404 });
  });
});
