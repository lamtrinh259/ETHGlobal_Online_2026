import { describe, expect, it, vi } from "vitest";
import { bytesToHex, recoverTypedDataAddress, stringToBytes, zeroHash, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  decodeInvite,
  eciesEncrypt,
  intentDomain,
  inviteDomain,
  recoverIntentSigner,
  recoverInviteSigner,
  ZERO_ADDRESS,
} from "@ketsuban/registrar";
import { toBytes32 } from "@peeramid-labs/multipass-client";
import { ApiError, createApi } from "@/lib/api";
import { loadWebConfig } from "@/lib/config";
import { buildIntent, intentTypedData, inviteLink, inviteTypedData, toWire } from "@/lib/intent";
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

describe("invitations", () => {
  it("signs an invite the registrar accepts and puts it in a URL-safe link", async () => {
    const invite = {
      handle: "alice",
      voucher: ZERO_ADDRESS,
      exp: BigInt(NOW + 604800),
      requires: [] as string[],
    };
    const td = inviteTypedData(invite, 11155111, "0x418F82fd0014a4CA402F145978bfaF0555a9cA06");
    expect(td.message.exp).toBe(String(invite.exp));
    expect(() => JSON.stringify(td)).not.toThrow();

    const signature = await account.signTypedData(td as never);
    expect(
      await recoverInviteSigner(invite, signature, inviteDomain(11155111, td.domain.verifyingContract))
    ).toBe(account.address);

    const link = inviteLink("https://app.example/", "alice", { ...invite, signature });
    expect(link.startsWith("https://app.example/vouch/alice?invite=")).toBe(true);
    const token = new URL(link).searchParams.get("invite")!;
    expect(decodeInvite(token)).toEqual({ ...invite, signature });
  });
});

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
    // viem types uint fields as bigint|number; EIP-712 hashing accepts a decimal string and
    // produces the identical hash, which is what lets the wallet JSON-serialise the message.
    const signature = await account.signTypedData(td as never);
    expect(
      await recoverIntentSigner(intent, signature, intentDomain(11155111, td.domain.verifyingContract!))
    ).toBe(account.address);
    expect(await recoverTypedDataAddress({ ...td, signature } as never)).toBe(account.address);
    // The wallet JSON-serialises the message, so nothing in it may be a BigInt.
    expect(Object.values(td.message).some((v) => typeof v === "bigint")).toBe(false);
    expect(() => JSON.stringify(td)).not.toThrow();
    expect(td.message.nonce).toBe(String(intent.nonce));
    expect(td.message.exp).toBe(String(NOW + 600));
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
      "http://api.test/v1/nonce": {
        body: {
          exists: true,
          nonce: "2",
          next: "3",
          ready: false,
          reason: 'domain "google" is not initialised',
        },
      },
      "http://api.test/v1/attest": { body: result },
      "http://api.test/v1/submit": { body: { ok: true, txHash: `0x${"ab".repeat(32)}` } },
      "http://api.test/v1/cre/delivery": { body: { ok: true, txHash: `0x${"cd".repeat(32)}` } },
      "http://api.test/v1/verify/alice.ketsuban.eth": { body: verification },
      "http://api.test/v1/ens/alice.ketsuban.eth?keys=ketsuban%3Aanswer": {
        body: {
          name: "alice.ketsuban.eth",
          universalResolver: account.address,
          resolver: account.address,
          addr: account.address,
          texts: { "ketsuban:answer": "terrible dictator" },
          status: "active",
          warning: "w",
        },
      },
      "http://api.test/v1/preflight": {
        body: { ok: false, warnings: ['domain "google" is not initialised'] },
      },
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
      "http://api.test/v1/profile/alice?links=x": {
        body: {
          handle: "alice",
          names: [
            {
              instance: "ketsuban",
              name: "alice.ketsuban.eth",
              verification: {
                name: "alice.ketsuban.eth",
                instance: { domain: "ketsuban", parentName: "ketsuban.eth" },
                status: "active",
                wallet: account.address,
                answer: "terrible dictator",
                expiresAt: "2027-01-01T00:00:00.000Z",
                humanity: null,
                links: [],
                evidence: ["wallet_binding"],
                decision: "additional_context_available",
                warning: "w",
              },
            },
            { instance: "kju-is", name: "alice.kju-is.ketsuban.eth", verification: null },
          ],
          vouches: [],
          standing: { claimed: true, given: 0, received: 0 },
          warning: "w",
        },
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
              standing: { claimed: true, given: 1, received: 0 },
              letter: "a letter",
            },
          ],
        },
      },
    });
    const api = createApi("http://api.test/", "http://api.test/v1/attest", fn);

    expect(await api.nonce(account.address, "x")).toEqual({
      exists: true,
      next: 3n,
      ready: false,
      reason: 'domain "google" is not initialised',
    });
    expect(calls[0].url).toBe(`http://api.test/v1/nonce?wallet=${account.address}&domain=x`);

    expect(await api.attest({ a: 1 })).toEqual(result);
    expect(calls[1].init?.method).toBe("POST");
    expect(JSON.parse(calls[1].init?.body as string)).toEqual({ a: 1 });

    // A browser has no delivery token and uses the open relay; the enclave's route needs one.
    expect(await api.deliver(result)).toEqual({ ok: true, txHash: `0x${"ab".repeat(32)}` });
    expect(await api.deliver(result, "tok")).toEqual({ ok: true, txHash: `0x${"cd".repeat(32)}` });
    const open = calls.find((c) => c.url.endsWith("/v1/submit"))!;
    const gated = calls.find((c) => c.url.endsWith("/v1/cre/delivery"))!;
    expect((open.init?.headers as Record<string, string>)["x-delivery-token"]).toBeUndefined();
    expect((gated.init?.headers as Record<string, string>)["x-delivery-token"]).toBe("tok");

    expect(await api.verify("alice.ketsuban.eth", { links: ["x"], viewCode: "0x02" })).toEqual(verification);
    const profile = await api.profile("alice", { links: ["x"] });
    expect(profile.names.map((n) => n.instance)).toEqual(["ketsuban", "kju-is"]);
    expect(profile.names[0].verification?.answer).toBe("terrible dictator");
    expect(profile.names[1].verification).toBeNull();
    expect(profile.standing.claimed).toBe(true);
    expect((await api.vouches("alice")).vouches[0].voucher).toBe("bob");
    expect((await api.vouches("alice")).vouches[0].standing).toEqual({
      claimed: true,
      given: 1,
      received: 0,
    });
    expect((await api.ens("alice.ketsuban.eth", ["ketsuban:answer"])).texts["ketsuban:answer"]).toBe(
      "terrible dictator"
    );
    const pre = await api.preflight();
    expect(pre).toEqual({ ok: false, warnings: ['domain "google" is not initialised'] });
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
    expect(
      calls.some((c) => c.url === "http://api.test/v1/verify/alice.ketsuban.eth?links=x&viewCode=0x02")
    ).toBe(true);
  });

  it("asks for a signed proof request and hands the proof back to the relay", async () => {
    // Two calls, in this order, and the wallet in both: the first gets the signature only the server
    // can make, the second is where the nullifier is checked and the record written. A client that
    // talked to World alone would show a tick over nothing.
    const { fn, calls } = fetchMock({
      "http://api.test/v1/humanity/challenge": {
        body: {
          app_id: "app_ketsuban",
          action: "kju-humanity",
          environment: "production",
          signal: account.address.toLowerCase(),
          rp_context: {
            rp_id: "rp_ketsuban",
            nonce: "0x00ab",
            created_at: 1_800_000_000,
            expires_at: 1_800_000_300,
            signature: "0xsig",
          },
        },
      },
      "http://api.test/v1/humanity": {
        body: {
          ok: true,
          level: "orb",
          until: "2026-10-08T09:14:22.000Z",
          nullifier: `0x${"11".repeat(32)}`,
          txHash: `0x${"ab".repeat(32)}`,
          renewal: false,
        },
      },
    });
    const api = createApi("http://api.test", "http://api.test/v1/attest", fn);

    const challenge = await api.humanityChallenge(account.address);
    expect(challenge.rp_context.rp_id).toBe("rp_ketsuban");
    expect(challenge.signal).toBe(account.address.toLowerCase());
    expect(calls[0].url).toBe("http://api.test/v1/humanity/challenge");
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({ wallet: account.address });

    const proved = await api.proveHumanity(account.address, { protocol_version: "3.0" });
    expect(proved).toMatchObject({ level: "orb", renewal: false });
    expect(calls[1].url).toBe("http://api.test/v1/humanity");
    expect(JSON.parse(calls[1].init?.body as string)).toEqual({
      wallet: account.address,
      proof: { protocol_version: "3.0" },
    });
  });

  it("reads the lookups a page needs before anybody signs anything", async () => {
    // Each of these answers a question the UI asks in order to say "no" cheaply: what a name would
    // claim, who already owns the label, which `bob` was meant, who holds an account, and what an
    // address is called. Each parses through its own schema, so a shape drift here is a broken page.
    const { fn, calls } = fetchMock({
      "http://api.test/v1/explain/alice.ketsuban.eth": {
        body: { name: "alice.ketsuban.eth", says: "a person", kind: "person" },
      },
      "http://api.test/v1/eth-label/alice": {
        body: { label: "alice", registry: account.address, owner: null },
      },
      "http://api.test/v1/find": { body: { q: "bob", matches: [] } },
      "http://api.test/v1/who": {
        body: { found: true, domain: "x.com", handle: "bob", wallet: account.address },
      },
      "http://api.test/v1/reverse/": {
        body: {
          address: account.address,
          name: "alice.ketsuban.eth",
          names: [],
          primary: null,
          note: "read from Multipass through the instance resolvers",
        },
      },
    });
    const api = createApi("http://api.test", "http://api.test/v1/attest", fn);

    expect((await api.explain("alice.ketsuban.eth")).kind).toBe("person");
    // `owner: null` is the answer that lets the page say nobody holds it, rather than a missing field.
    expect((await api.ethLabel("alice")).owner).toBeNull();
    expect((await api.find("bob")).matches).toEqual([]);
    expect((await api.who("x.com", "bob")).found).toBe(true);
    expect((await api.reverse(account.address)).name).toBe("alice.ketsuban.eth");
    // The view code is a permission, so it only travels when the reader was given one.
    expect(calls[3].url).toBe("http://api.test/v1/who?domain=x.com&handle=bob");
    await api.who("x.com", "bob", "0x01");
    expect(calls[5].url).toBe("http://api.test/v1/who?domain=x.com&handle=bob&viewCode=0x01");
  });

  it("refuses a challenge that is missing the signature World needs", async () => {
    // A half-built rp_context would open a widget World then refuses, which reads as the user's fault.
    const { fn } = fetchMock({
      "http://api.test/v1/humanity/challenge": {
        body: { app_id: "app_x", action: "a", environment: "production", signal: "0x1", rp_context: {} },
      },
    });
    const api = createApi("http://api.test", "http://api.test/v1/attest", fn);
    await expect(api.humanityChallenge(account.address)).rejects.toThrow();
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

describe("addresses that arrive in the wrong case", () => {
  it("are normalised in the browser config too, not carried until a write fails", async () => {
    // The same checksum trap as the attester: viem refuses an address whose EIP-55 casing does not
    // match, and here it would surface as a failed transaction rather than as a bad setting.
    const { loadWebConfig } = await import("@/lib/config");
    const config = loadWebConfig({
      NEXT_PUBLIC_PRIVY_APP_ID: "app",
      NEXT_PUBLIC_PRIVY_CLIENT_ID: "client",
      NEXT_PUBLIC_API_URL: "http://api.test",
      NEXT_PUBLIC_ATTEST_URL: "http://api.test/v1/attest",
      NEXT_PUBLIC_CHAIN_ID: "11155111",
      NEXT_PUBLIC_MULTIPASS: "0x418f82fd0014a4ca402f145978bfaf0555a9ca06",
      NEXT_PUBLIC_NAME_DOMAINS: "ketsuban",
      NEXT_PUBLIC_PARENT_NAMES: "ketsuban.eth",
    });
    expect(config.multipass).toBe("0x418F82fd0014a4CA402F145978bfaF0555a9cA06");
  });
});
