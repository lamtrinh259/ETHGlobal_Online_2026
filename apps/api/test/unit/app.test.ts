import { describe, expect, it, vi } from "vitest";
import { bytesToHex, encodePacked, keccak256, zeroAddress, zeroHash, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseIntent, fakePrivy, fakeUser, signedAttestRequest, toWire } from "@ketsuban/registrar/testing";
import { eciesDecrypt, type RegisterMessage } from "@ketsuban/registrar";
import {
  decodeRecord,
  maskId,
  maskName,
  toBytes32,
  viewCodeCommitment,
} from "@peeramid-labs/multipass-client";
import { createApp, locate, WARNING } from "../../src/app.js";
import type { ChainReader, Instance, ListedRecord } from "../../src/chain.js";
import { loadConfig } from "../../src/config.js";

const NOW = 1_800_000_000;
const USER_KEY = "0x000000000000000000000000000000000000000000000000000000000000a11c" as const;
const privy = fakePrivy("cltest-app-id");
const user = fakeUser(USER_KEY);
const registrar = privateKeyToAccount("0x000000000000000000000000000000000000000000000000000000000000b0b0");

const baseEnv = {
  RPC_URL: "http://127.0.0.1:8545",
  CHAIN_ID: "31337",
  MULTIPASS: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  BRIDGE: "0x0B306BF915C4d645ff596e518fAf3F9669b97016",
  FACTORY: "0x9A676e781A523b5d0C0e43731313A708CB607508",
  RELAYER_KEY: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  PRIVY_APP_ID: privy.appId,
  PRIVY_VERIFICATION_KEY_JWK: JSON.stringify(privy.jwk),
  NAME_DOMAINS: "kju-is, uni",
  REGISTRAR_KEY: "0x000000000000000000000000000000000000000000000000000000000000b0b0",
  VIEWCODE_KEY: "0x1111111111111111111111111111111111111111111111111111111111111111",
  DELIVERY_TOKEN: "0123456789abcdef0123456789abcdef",
};

const instance: Instance = {
  domain: "kju-is",
  registry: "0x06cd7788D77332cF1156f1E327eBC090B5FF16a3",
  resolver: "0x8e80FFe6Dc044F4A766Afd6e5a8732Fe0977A493",
  parentName: "kju-is.eth",
  parentLabel: "kju-is",
};

type State = {
  records: Record<string, { exists: boolean; nonce: bigint; id: Hex; wallet: Address }>;
  texts: Record<string, string>;
  addr: Address;
  data: Record<string, Hex>;
  listed: Record<string, ListedRecord[]>;
  instancesCreated: string[];
  byWallet: (ListedRecord & { domain: string })[];
  names: Record<string, { taken: boolean; wallet: Address | null; live: boolean }>;
  balance: bigint;
  sent: { to: Address; value: bigint }[];
};

function fakeChain(state: Partial<State> = {}) {
  const s: State = {
    records: {},
    texts: {},
    addr: zeroAddress,
    data: {},
    listed: {},
    instancesCreated: [],
    balance: 0n,
    sent: [],
    ...state,
  };
  const submitted: { record: RegisterMessage; signature: Hex }[] = [];
  const chain: ChainReader = {
    relayer: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    readOnchain: vi.fn(
      async (wallet: Address, domain: string) =>
        s.records[`${wallet.toLowerCase()}:${domain}`] ?? {
          exists: false,
          nonce: 0n,
          id: zeroHash,
          wallet: zeroAddress,
        }
    ),
    instances: vi.fn(async () => [instance]),
    submit: vi.fn(async (record: RegisterMessage, signature: Hex) => {
      submitted.push({ record, signature });
      return `0x${"ab".repeat(32)}` as Hex;
    }),
    resolveText: vi.fn(async (_r: Address, _n: string, key: string) => s.texts[key] ?? ""),
    resolveAddr: vi.fn(async () => s.addr),
    resolveData: vi.fn(async (_r: Address, _n: string, key: string) => s.data[key] ?? "0x"),
    ensureVouchInstance: vi.fn(async (handle: string) => {
      const created = !s.instancesCreated.includes(handle);
      if (created) s.instancesCreated.push(handle);
      return { domain: `~${handle}`, created };
    }),
    listRecords: vi.fn(async (domain: string) => s.listed[domain] ?? []),
    nameStatus: vi.fn(
      async (domain: string, handle: string) =>
        s.names[`${domain}/${handle}`] ?? { taken: false, wallet: null, live: false }
    ),
    listRecordsByWallet: vi.fn(async () => s.byWallet),
    balance: vi.fn(async () => s.balance),
    sendEth: vi.fn(async (to: Address, value: bigint) => {
      s.sent.push({ to, value });
      return `0x${"cc".repeat(32)}` as Hex;
    }),
  };
  return { chain, submitted, state: s };
}

function app(chain: ChainReader, env: Record<string, string> = baseEnv) {
  return createApp({ config: loadConfig(env), chain, now: () => NOW });
}

async function wireRequest(over: Parameters<typeof baseIntent>[2] = {}) {
  const intent = baseIntent(user.account, NOW, over);
  const idToken = privy.mint({ sub: user.did, linked: user.linked, now: NOW });
  return toWire(await signedAttestRequest(user.account, intent, idToken, 31337, baseEnv.MULTIPASS as Hex));
}

const post = (
  a: ReturnType<typeof createApp>,
  path: string,
  body: unknown,
  headers: Record<string, string> = {}
) =>
  a.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

describe("config", () => {
  it("parses name domains and the JWK", () => {
    const c = loadConfig(baseEnv);
    expect(c.NAME_DOMAINS).toEqual(["kju-is", "uni"]);
    expect(c.PRIVY_VERIFICATION_KEY_JWK).toEqual(privy.jwk);
    expect(c.PORT).toBe(8787);
    expect(c.RECORD_TERM_SECONDS).toBe(2_592_000);
  });

  it("parses the gas top-up amount as wei, defaulting to disabled", () => {
    expect(loadConfig(baseEnv).GAS_TOPUP_WEI).toBe(0n);
    expect(loadConfig({ ...baseEnv, GAS_TOPUP_WEI: "2000000000000000" }).GAS_TOPUP_WEI).toBe(
      2_000_000_000_000_000n
    );
    expect(() => loadConfig({ ...baseEnv, GAS_TOPUP_WEI: "0.1" })).toThrow();
  });

  it("fills addresses from a deployment file, env wins", () => {
    const c = loadConfig({
      ...baseEnv,
      MULTIPASS: "",
      BRIDGE: "",
      FACTORY: "",
      CHAIN_ID: "",
      DEPLOYMENT_FILE: new URL("./deployment.fixture.json", import.meta.url).pathname,
    });
    expect(c.MULTIPASS).toBe("0x5FbDB2315678afecb367f032d93F642f64180aa3");
    expect(c.BRIDGE).toBe("0x0B306BF915C4d645ff596e518fAf3F9669b97016");
    expect(c.CHAIN_ID).toBe(31337);
    expect(
      loadConfig({
        ...baseEnv,
        CHAIN_ID: "1",
        DEPLOYMENT_FILE: new URL("./deployment.fixture.json", import.meta.url).pathname,
      }).CHAIN_ID
    ).toBe(1);
  });

  it("rejects a malformed JWK and a missing RPC", () => {
    expect(() => loadConfig({ ...baseEnv, PRIVY_VERIFICATION_KEY_JWK: '{"kty":"RSA"}' })).toThrow();
    expect(() => loadConfig({ ...baseEnv, RPC_URL: "nope" })).toThrow();
  });
});

describe("CORS", () => {
  it("allows any origin by default and only listed origins when configured", async () => {
    const { chain } = fakeChain();
    const open = await app(chain).request("/healthz", { headers: { origin: "https://x.example" } });
    expect(open.headers.get("access-control-allow-origin")).toBe("*");
    const strict = app(chain, { ...baseEnv, CORS_ORIGINS: "https://app.example, https://b.example" });
    const ok = await strict.request("/healthz", { headers: { origin: "https://app.example" } });
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://app.example");
    const no = await strict.request("/healthz", { headers: { origin: "https://evil.example" } });
    expect(no.headers.get("access-control-allow-origin")).toBeNull();
    const pre = await strict.request("/v1/cre/delivery", {
      method: "OPTIONS",
      headers: {
        origin: "https://app.example",
        "access-control-request-method": "POST",
        "access-control-request-headers": "x-delivery-token",
      },
    });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("x-delivery-token");
  });
});

describe("GET /healthz", () => {
  it("attests with the default clock", async () => {
    const { chain } = fakeChain();
    const res = await post(
      createApp({ config: loadConfig(baseEnv), chain }),
      "/v1/attest",
      await wireRequest()
    );
    expect(res.status).toBe(200);
  });

  it("reports relayer and chain", async () => {
    const { chain } = fakeChain();
    const res = await app(chain).request("/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, relayer: chain.relayer, chainId: 31337 });
  });

  it("GET /v1/instances lists instances with the contracts a wallet writes to", async () => {
    const { chain } = fakeChain();
    const res = await app(chain).request("/v1/instances");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      instances: [instance],
      bridge: baseEnv.BRIDGE,
      permissionedResolver: null,
    });
    const withResolver = createApp({
      config: loadConfig({ ...baseEnv, PERMISSIONED_RESOLVER: baseEnv.FACTORY }),
      chain,
    });
    expect((await (await withResolver.request("/v1/instances")).json()).permissionedResolver).toBe(
      baseEnv.FACTORY
    );
  });
});

describe("GET /v1/nonce", () => {
  it("returns the on-chain nonce and the next usable one", async () => {
    const key = `${user.account.address.toLowerCase()}:x`;
    const { chain } = fakeChain({
      records: { [key]: { exists: true, nonce: 2n, id: toBytes32("1"), wallet: user.account.address } },
    });
    const body = await (await app(chain).request(`/v1/nonce?wallet=${user.account.address}&domain=x`)).json();
    expect(body).toEqual({
      exists: true,
      nonce: "2",
      next: "3",
      id: toBytes32("1"),
      wallet: user.account.address,
    });
    const fresh = await (
      await app(chain).request(`/v1/nonce?wallet=${user.account.address}&domain=telegram`)
    ).json();
    expect(fresh).toMatchObject({ exists: false, nonce: "0", next: "1" });
    expect((await app(chain).request(`/v1/nonce?wallet=nope&domain=x`)).status).toBe(400);
  });
});

describe("POST /v1/attest (node registrar fallback)", () => {
  it("signs a record identical in shape to the enclave output", async () => {
    const { chain } = fakeChain();
    const res = await post(app(chain), "/v1/attest", await wireRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.record).toEqual({
      name: toBytes32("alice"),
      id: toBytes32("1234567890123456789"),
      domainName: toBytes32("x"),
      validUntil: String(NOW + 2_592_000),
      nonce: "1",
      wallet: user.account.address,
      payload: zeroHash,
    });
    expect(body.signature).toMatch(/^0x[0-9a-f]{130}$/);
    expect(body.viewCode).toBeNull();
    expect(chain.readOnchain).toHaveBeenCalledWith(user.account.address, "x");
  });

  it("returns an encrypted view code for opted-in requests", async () => {
    const { chain } = fakeChain();
    const body = await (await post(app(chain), "/v1/attest", await wireRequest({ optIn: true }))).json();
    const viewCode = bytesToHex(eciesDecrypt(USER_KEY, body.viewCode));
    expect(decodeRecord(body.record, viewCode)).toEqual({
      handle: "alice",
      platformId: "1234567890123456789",
    });
  });

  it("uses the on-chain nonce for renewals and rejects stale intents", async () => {
    const key = `${user.account.address.toLowerCase()}:x`;
    const { chain } = fakeChain({
      records: {
        [key]: {
          exists: true,
          nonce: 2n,
          id: toBytes32("1234567890123456789"),
          wallet: user.account.address,
        },
      },
    });
    const stale = await post(app(chain), "/v1/attest", await wireRequest({ nonce: 2n }));
    expect(stale.status).toBe(422);
    expect(await stale.json()).toEqual({ error: "intent: nonce not increasing" });
    const ok = await (await post(app(chain), "/v1/attest", await wireRequest({ nonce: 3n }))).json();
    expect(ok.record.nonce).toBe("3");
  });

  it("400s malformed bodies and 501s when the registrar is disabled", async () => {
    const { chain } = fakeChain();
    expect((await post(app(chain), "/v1/attest", { idToken: 1 })).status).toBe(400);
    const { REGISTRAR_KEY: _r, VIEWCODE_KEY: _v, ...disabled } = baseEnv;
    expect((await post(app(chain, disabled), "/v1/attest", await wireRequest())).status).toBe(501);
  });
});

describe("POST /v1/cre/delivery", () => {
  const delivery = () => ({
    record: {
      name: toBytes32("alice"),
      id: toBytes32("1"),
      domainName: toBytes32("x"),
      validUntil: "1800000000",
      nonce: "1",
      wallet: user.account.address,
      payload: zeroHash,
    },
    signature: `0x${"11".repeat(65)}`,
    viewCode: null,
  });

  it("submits through the bridge and returns the tx hash", async () => {
    const { chain, submitted } = fakeChain();
    const res = await post(app(chain), "/v1/cre/delivery", delivery(), {
      "x-delivery-token": baseEnv.DELIVERY_TOKEN,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, txHash: `0x${"ab".repeat(32)}` });
    expect(submitted).toHaveLength(1);
    expect(submitted[0].record).toEqual({ ...delivery().record, validUntil: 1800000000n, nonce: 1n });
    expect(submitted[0].signature).toBe(delivery().signature);
  });

  it("rejects a missing or wrong token, malformed bodies, and surfaces chain failures", async () => {
    const { chain } = fakeChain();
    expect((await post(app(chain), "/v1/cre/delivery", delivery())).status).toBe(401);
    expect(
      (
        await post(
          app(chain),
          "/v1/cre/delivery",
          { record: {} },
          { "x-delivery-token": baseEnv.DELIVERY_TOKEN }
        )
      ).status
    ).toBe(400);
    (chain.submit as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("recordExists"));
    const res = await post(app(chain), "/v1/cre/delivery", delivery(), {
      "x-delivery-token": baseEnv.DELIVERY_TOKEN,
    });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, error: "recordExists" });
  });

  it("provisions the vouch instance when a root name is claimed, idempotently, and survives provisioning failure", async () => {
    const { chain, state } = fakeChain();
    const root = {
      ...delivery(),
      record: { ...delivery().record, domainName: toBytes32("kju-is"), name: toBytes32("alice") },
    };
    const first = await (
      await post(app(chain), "/v1/cre/delivery", root, { "x-delivery-token": baseEnv.DELIVERY_TOKEN })
    ).json();
    expect(first).toEqual({
      ok: true,
      txHash: `0x${"ab".repeat(32)}`,
      vouchInstance: { domain: "~alice", created: true },
    });
    const again = await (
      await post(app(chain), "/v1/cre/delivery", root, { "x-delivery-token": baseEnv.DELIVERY_TOKEN })
    ).json();
    expect(again.vouchInstance).toEqual({ domain: "~alice", created: false });
    expect(state.instancesCreated).toEqual(["alice"]);
    expect(chain.ensureVouchInstance).toHaveBeenCalledWith("alice");

    (chain.ensureVouchInstance as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("no gas"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const degraded = await (
      await post(app(chain), "/v1/cre/delivery", root, { "x-delivery-token": baseEnv.DELIVERY_TOKEN })
    ).json();
    expect(degraded).toEqual({ ok: true, txHash: `0x${"ab".repeat(32)}` });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("accepts deliveries without a token when none is configured", async () => {
    const { chain } = fakeChain();
    const { DELIVERY_TOKEN: _t, ...open } = baseEnv;
    expect((await post(app(chain, open), "/v1/cre/delivery", delivery())).status).toBe(200);
  });
});

describe("GET /v1/verify/:name", () => {
  it("404s names under no known instance", async () => {
    const { chain } = fakeChain();
    expect((await app(chain).request("/v1/verify/alice.eth")).status).toBe(404);
  });

  it("reports an inactive name with the warning", async () => {
    const { chain } = fakeChain();
    const body = await (await app(chain).request("/v1/verify/nobody.kju-is.eth")).json();
    expect(body).toEqual({
      name: "nobody.kju-is.eth",
      instance: { domain: "kju-is", parentName: "kju-is.eth" },
      status: "inactive",
      wallet: null,
      answer: null,
      expiresAt: null,
      humanity: null,
      links: [],
      profile: { avatar: null, description: null, url: null, email: null },
      evidence: ["wallet_binding"],
      decision: "no_record",
      warning: WARNING,
    });
  });

  it("exposes the user's ENS profile text records", async () => {
    const { chain } = fakeChain({
      addr: user.account.address,
      texts: { avatar: "ipfs://pig", description: "prof of maths", url: "https://alice.example" },
    });
    const body = await (await app(chain).request("/v1/verify/alice.kju-is.eth")).json();
    expect(body.profile).toEqual({
      avatar: "ipfs://pig",
      description: "prof of maths",
      url: "https://alice.example",
      email: null,
    });
    expect(chain.resolveText).toHaveBeenCalledWith(instance.resolver, "alice.kju-is.eth", "avatar");
  });

  it("assembles an active record from resolver reads, including opted-in links", async () => {
    const viewCode = keccak256("0x01");
    const masked = {
      name: maskName("alice_x", viewCode),
      id: maskId("42", viewCode),
      payload: viewCodeCommitment(viewCode),
    };
    const { chain } = fakeChain({
      addr: user.account.address,
      texts: {
        "ketsuban:answer": "terrible dictator",
        "ketsuban:expiry": String(NOW + 100),
        "ketsuban:humanity": "medium",
        "ketsuban:humanity:until": String(NOW + 50),
      },
      data: {
        "ketsuban:link:x": encodePacked(
          ["bytes32", "bytes32", "bytes32"],
          [masked.name, masked.id, masked.payload]
        ),
        "ketsuban:link:telegram": encodePacked(
          ["bytes32", "bytes32", "bytes32"],
          [toBytes32("alice_tg"), toBytes32("987"), zeroHash]
        ),
      },
    });
    const body = await (
      await app(chain).request(`/v1/verify/alice.kju-is.eth?links=x,telegram&viewCode=${viewCode}`)
    ).json();
    expect(body.status).toBe("active");
    expect(body.wallet).toBe(user.account.address);
    expect(body.answer).toBe("terrible dictator");
    expect(body.expiresAt).toBe(new Date((NOW + 100) * 1000).toISOString());
    expect(body.humanity).toEqual({ level: "medium", until: new Date((NOW + 50) * 1000).toISOString() });
    expect(body.links).toEqual([
      {
        domain: "x",
        optedIn: true,
        commitment: masked.payload,
        disclosed: { handle: "alice_x", platformId: "42" },
      },
      { domain: "telegram", optedIn: false },
    ]);
    expect(body.evidence).toEqual([
      "wallet_binding",
      "humanity_attestation",
      "x_account_control",
      "telegram_account_control",
    ]);
    expect(body.decision).toBe("additional_context_available");
    expect(chain.resolveData).toHaveBeenCalledWith(instance.resolver, "alice.kju-is.eth", "ketsuban:link:x");
  });

  it("skips malformed link payloads and honours an explicit links list", async () => {
    const { chain } = fakeChain({
      addr: user.account.address,
      data: { "ketsuban:link:x": "0x01", "ketsuban:link:telegram": "0x" },
    });
    const body = await (await app(chain).request("/v1/verify/alice.kju-is.eth?links=x,telegram")).json();
    expect(body.links).toEqual([]);
    expect(body.evidence).toEqual(["wallet_binding"]);
    expect(chain.resolveData).toHaveBeenCalledTimes(2);
  });

  it("keeps opted-in links masked without a matching view code", async () => {
    const viewCode = keccak256("0x02");
    const masked = encodePacked(
      ["bytes32", "bytes32", "bytes32"],
      [maskName("h", viewCode), maskId("1", viewCode), viewCodeCommitment(viewCode)]
    );
    const { chain } = fakeChain({ addr: user.account.address, data: { "ketsuban:link:x": masked } });
    const body = await (
      await app(chain).request(`/v1/verify/alice.kju-is.eth?links=x&viewCode=${keccak256("0x03")}`)
    ).json();
    expect(body.links).toEqual([{ domain: "x", optedIn: true, commitment: viewCodeCommitment(viewCode) }]);
  });
});

describe("locate", () => {
  it("matches the longest known parent and rejects nested labels", () => {
    expect(locate("alice.kju-is.eth", [instance])).toEqual({ handle: "alice", instance });
    expect(locate("a.b.kju-is.eth", [instance])).toBeUndefined();
    expect(locate("kju-is.eth", [instance])).toBeUndefined();
    expect(locate("x.other.eth", [instance])).toBeUndefined();
  });
});

describe("GET /v1/vouches/:handle", () => {
  const bobVouch = {
    name: "bob",
    id: toBytes32("b"),
    wallet: user.account.address,
    payload: toBytes32("worked together 2019-22"),
    validUntil: 1_800_000_000n,
    nonce: 1n,
    live: true,
  };
  const carolVouch = {
    name: "carol",
    id: toBytes32("c"),
    wallet: zeroAddress,
    payload: toBytes32("revoked"),
    validUntil: 1_700_000_000n,
    nonce: 2n,
    live: false,
  };

  it("lists the vouch domain's records with voucher names, liveness and each live voucher's standing", async () => {
    const { chain } = fakeChain({
      listed: {
        "~alice": [bobVouch, carolVouch],
        "~bob": [
          { ...carolVouch, live: true },
          { ...bobVouch, name: "dave" },
        ],
      },
      names: { "kju-is/bob": { taken: true, wallet: user.account.address, live: true } },
      byWallet: [
        { ...bobVouch, domain: "~alice" },
        { ...bobVouch, domain: "~erin", nonce: 2n },
        { ...bobVouch, domain: "~erin", nonce: 1n, live: false },
        { ...bobVouch, domain: "~old", live: false },
        { ...bobVouch, domain: "kju-is" },
      ],
    });
    const body = await (await app(chain).request("/v1/vouches/Alice")).json();
    expect(body).toEqual({
      handle: "alice",
      domain: "~alice",
      vouches: [
        {
          voucher: "bob",
          voucherName: "bob.kju-is.eth",
          wallet: user.account.address,
          statement: "worked together 2019-22",
          validUntil: "2027-01-15T08:00:00.000Z",
          nonce: "1",
          live: true,
          standing: { claimed: true, given: 2, received: 2 },
        },
        {
          voucher: "carol",
          voucherName: "carol.kju-is.eth",
          wallet: zeroAddress,
          statement: "revoked",
          validUntil: "2023-11-14T22:13:20.000Z",
          nonce: "2",
          live: false,
          standing: null,
        },
      ],
      warning: WARNING,
    });
    expect(chain.listRecords).toHaveBeenCalledWith("~alice");
    expect(chain.nameStatus).toHaveBeenCalledWith("kju-is", "bob");
    expect(chain.nameStatus).not.toHaveBeenCalledWith("kju-is", "carol");
    expect((await app(chain).request("/v1/vouches/Not%20Valid")).status).toBe(400);
    expect((await (await app(chain).request("/v1/vouches/nobody")).json()).vouches).toEqual([]);
  });
});

describe("GET /v1/standing/:handle", () => {
  it("counts distinct live references given and received; unclaimed handles can still receive", async () => {
    const { chain } = fakeChain({
      listed: {
        "~alice": [
          {
            name: "bob",
            id: toBytes32("b"),
            wallet: zeroAddress,
            payload: zeroHash,
            validUntil: 1n,
            nonce: 1n,
            live: true,
          },
        ],
      },
      names: { "kju-is/bob": { taken: true, wallet: user.account.address, live: true } },
      byWallet: [
        {
          name: "bob",
          id: toBytes32("b"),
          wallet: user.account.address,
          payload: zeroHash,
          validUntil: 1n,
          nonce: 1n,
          live: true,
          domain: "~alice",
        },
      ],
    });
    expect(await (await app(chain).request("/v1/standing/alice")).json()).toEqual({
      handle: "alice",
      claimed: false,
      given: 0,
      received: 1,
      warning: WARNING,
    });
    expect(await (await app(chain).request("/v1/standing/BOB")).json()).toEqual({
      handle: "bob",
      claimed: true,
      given: 1,
      received: 0,
      warning: WARNING,
    });
    expect((await app(chain).request("/v1/standing/no%20way")).status).toBe(400);
  });
});

describe("GET /v1/name/:domain/:handle", () => {
  it("reports availability and the holder", async () => {
    const { chain } = fakeChain({
      names: { "kju-is/alice": { taken: true, wallet: user.account.address, live: true } },
    });
    expect(await (await app(chain).request("/v1/name/kju-is/Alice")).json()).toEqual({
      domain: "kju-is",
      handle: "alice",
      taken: true,
      wallet: user.account.address,
      live: true,
    });
    expect(await (await app(chain).request("/v1/name/kju-is/free")).json()).toMatchObject({
      taken: false,
      wallet: null,
    });
    expect((await app(chain).request("/v1/name/kju-is/bad%20name")).status).toBe(400);
  });
});

describe("GET /v1/wallet/:address", () => {
  it("splits a wallet's records into names, links and references given", async () => {
    const rec = (
      domain: string,
      name: string,
      payload: string,
      live = true
    ): ListedRecord & { domain: string } => ({
      domain,
      name,
      id: toBytes32(name),
      wallet: user.account.address,
      payload: toBytes32(payload),
      validUntil: 1_800_000_000n,
      nonce: 1n,
      live,
    });
    const { chain } = fakeChain({
      byWallet: [
        rec("kju-is", "alice", "hi"),
        rec("x", "alice_x", ""),
        rec("~bob", "alice", "great colleague", false),
      ],
    });
    const body = await (await app(chain).request(`/v1/wallet/${user.account.address}`)).json();
    expect(body.names).toEqual([
      {
        domain: "kju-is",
        name: "alice",
        payload: "hi",
        validUntil: "2027-01-15T08:00:00.000Z",
        nonce: "1",
        live: true,
        ensName: "alice.kju-is.eth",
      },
    ]);
    expect(body.links).toEqual([
      {
        domain: "x",
        name: "alice_x",
        payload: "",
        validUntil: "2027-01-15T08:00:00.000Z",
        nonce: "1",
        live: true,
        optedIn: false,
      },
    ]);
    expect(body.given).toEqual([
      {
        domain: "~bob",
        name: "alice",
        payload: "great colleague",
        validUntil: "2027-01-15T08:00:00.000Z",
        nonce: "1",
        live: false,
        candidate: "bob",
        ensName: "alice.bob.kju-is.eth",
      },
    ]);
    expect(body.balance).toBe("0");
    expect(body.gasTopup).toEqual({ enabled: false, amount: "0", available: false });
    expect((await app(chain).request("/v1/wallet/nope")).status).toBe(400);
  });

  it("offers a gas top-up only when enabled, the wallet holds a live name and is below the amount", async () => {
    const live = {
      domain: "kju-is",
      name: "alice",
      id: toBytes32("alice"),
      wallet: user.account.address,
      payload: zeroHash,
      validUntil: 1_800_000_000n,
      nonce: 1n,
      live: true,
    };
    const gasApp = (chain: ChainReader) =>
      createApp({
        config: loadConfig({ ...baseEnv, GAS_TOPUP_WEI: "2000000000000000" }),
        chain,
        now: () => NOW,
      });
    const { chain } = fakeChain({ byWallet: [live], balance: 1_000_000_000_000_000n });
    const body = await (await gasApp(chain).request(`/v1/wallet/${user.account.address}`)).json();
    expect(body.balance).toBe("1000000000000000");
    expect(body.gasTopup).toEqual({ enabled: true, amount: "2000000000000000", available: true });

    const rich = fakeChain({ byWallet: [live], balance: 5_000_000_000_000_000n });
    expect(
      (await (await gasApp(rich.chain).request(`/v1/wallet/${user.account.address}`)).json()).gasTopup
        .available
    ).toBe(false);
    const noName = fakeChain({ byWallet: [{ ...live, live: false }] });
    expect(
      (await (await gasApp(noName.chain).request(`/v1/wallet/${user.account.address}`)).json()).gasTopup
        .available
    ).toBe(false);
  });
});

describe("POST /v1/gas", () => {
  const live = {
    domain: "kju-is",
    name: "alice",
    id: toBytes32("alice"),
    wallet: user.account.address,
    payload: zeroHash,
    validUntil: 1_800_000_000n,
    nonce: 1n,
    live: true,
  };
  const gasApp = (chain: ChainReader, wei = "2000000000000000") =>
    createApp({ config: loadConfig({ ...baseEnv, GAS_TOPUP_WEI: wei }), chain, now: () => NOW });
  const body = { wallet: user.account.address };

  it("is disabled unless GAS_TOPUP_WEI is set", async () => {
    const { chain } = fakeChain({ byWallet: [live] });
    expect((await post(app(chain), "/v1/gas", body)).status).toBe(501);
  });

  it("sends the configured amount once to a wallet with a live name and a low balance", async () => {
    const { chain, state } = fakeChain({ byWallet: [live], balance: 0n });
    const a = gasApp(chain);
    const res = await post(a, "/v1/gas", body);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hash: `0x${"cc".repeat(32)}`, amount: "2000000000000000" });
    expect(state.sent).toEqual([{ to: user.account.address, value: 2_000_000_000_000_000n }]);

    const again = await post(a, "/v1/gas", body);
    expect(again.status).toBe(409);
    expect((await again.json()).error).toMatch(/already/);
    expect(state.sent).toHaveLength(1);
  });

  it("refuses bad, nameless and already-funded wallets", async () => {
    const { chain, state } = fakeChain({ byWallet: [live], balance: 3_000_000_000_000_000n });
    expect((await post(gasApp(chain), "/v1/gas", { wallet: "nope" })).status).toBe(400);
    const funded = await post(gasApp(chain), "/v1/gas", body);
    expect(funded.status).toBe(409);
    expect((await funded.json()).error).toMatch(/enough/);
    const nameless = fakeChain({ byWallet: [], balance: 0n });
    const res = await post(gasApp(nameless.chain), "/v1/gas", body);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/live name/);
    expect(state.sent).toEqual([]);
    expect(nameless.state.sent).toEqual([]);
  });
});
