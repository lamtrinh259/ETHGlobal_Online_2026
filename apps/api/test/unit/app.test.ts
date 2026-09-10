import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  bytesToHex,
  encodePacked,
  hexToBytes,
  keccak256,
  recoverTypedDataAddress,
  type Address,
  type Hex,
  zeroAddress,
  zeroHash,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  baseIntent,
  fakePrivy,
  fakeUser,
  signedAttestRequest,
  signedInvite,
  toWire,
} from "@ketsuban/registrar/testing";
import {
  discloseDomain,
  eciesDecrypt,
  eciesEncrypt,
  hashBoxes,
  signDisclosure,
  signRevocation,
  type RegisterMessage,
} from "@ketsuban/registrar";
import {
  decodeRecord,
  fromBytes32,
  maskId,
  maskName,
  registerNameTypes,
  toBytes32,
  viewCodeCommitment,
} from "@peeramid-labs/multipass-client";
import { createApp, locate, WARNING } from "../../src/app.js";
import type { ChainReader, Instance, ListedRecord, Preflight } from "../../src/chain.js";
import { explainConfigError, loadConfig } from "../../src/config.js";

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
  // Keep the persistent stores in memory: the default is the container's `/data`, and a test that logs
  // `EACCES: mkdir '/data'` reads like a failure while asserting the opposite.
  DATA_DIR: "",
};

const instance: Instance = {
  domain: "kju-is",
  registry: "0x06cd7788D77332cF1156f1E327eBC090B5FF16a3",
  resolver: "0x8e80FFe6Dc044F4A766Afd6e5a8732Fe0977A493",
  parentName: "kju-is.eth",
  parentLabel: "kju-is",
};

/** The platform this deployment mounts, which is what makes `x` writable at all. */
const xInstance: Instance = {
  ...instance,
  domain: "x",
  parentName: "x.kju-is.eth",
  parentLabel: "x",
};

/** The same platform mounted at its DNS name, with the private branch the mirror gives it. */
const xComInstance: Instance = {
  ...instance,
  domain: "x.com",
  parentName: "com.x.www.kju-is.eth",
  parentLabel: "com",
  maskedParentName: "com.x.private-www.kju-is.eth",
  maskedResolver: "0x2222222222222222222222222222222222222222" as const,
};

/** A provisioned vouch instance for alice, as the relay creates it. */
const vouchInstance: Instance = {
  ...instance,
  domain: "~alice",
  resolver: "0x1111111111111111111111111111111111111111",
  parentName: "alice.kju-is.eth",
  parentLabel: "alice",
};

type State = {
  records: Record<string, { exists: boolean; nonce: bigint; id: Hex; wallet: Address }>;
  texts: Record<string, string>;
  addr: Address;
  /** What a particular name resolves to, when the test needs two names to answer differently */
  addrByName: Record<string, Address>;
  data: Record<string, Hex>;
  listed: Record<string, ListedRecord[]>;
  instancesCreated: string[];
  byWallet: (ListedRecord & { domain: string })[];
  names: Record<string, { taken: boolean; wallet: Address | null; live: boolean }>;
  instances: Instance[];
  universal: { resolver: Address; addr: Address; texts: Record<string, string> } | Error;
  balance: bigint;
  sent: { to: Address; value: bigint }[];
  preflight: Preflight;
  ready: Record<string, { initialised: boolean; active: boolean; registrarOk: boolean }>;
  reverse: Record<string, string>;
  /** What ENS itself answers for the address, which only its holder can set */
  primary: string | null;
};

function fakeChain(state: Partial<State> = {}) {
  const s: State = {
    records: {},
    texts: {},
    addr: zeroAddress,
    addrByName: {},
    data: {},
    listed: {},
    instancesCreated: [],
    byWallet: [],
    names: {},
    reverse: {},
    primary: null,
    ready: {},
    instances: [instance, xInstance],
    preflight: {
      ok: true,
      bridge: { address: baseEnv.BRIDGE as Address, deployed: true, missing: [] },
      multipass: {
        address: baseEnv.MULTIPASS as Address,
        deployed: true,
        domains: [
          { domain: "kju-is", active: true, registrar: registrar.address, fee: "0", renewalFee: "0" },
        ],
      },
      factory: { address: baseEnv.FACTORY as Address, deployed: true, instances: ["kju-is"] },
      namespaceFactory: null,
      registrar: { signsAs: registrar.address, onchain: [registrar.address] },
      relayer: { address: registrar.address, balance: "1000000000000000000" },
      warnings: [],
    },
    universal: {
      resolver: "0x178ff1589Be8Af3B19426Aa1d2Bd07cd178E215e",
      addr: user.account.address,
      texts: {},
    },
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
    instances: vi.fn(async () => s.instances),
    submit: vi.fn(async (record: RegisterMessage, signature: Hex) => {
      submitted.push({ record, signature });
      return `0x${"ab".repeat(32)}` as Hex;
    }),
    resolveText: vi.fn(
      async (_r: Address, name: string, key: string) => s.texts[`${name}/${key}`] ?? s.texts[key] ?? ""
    ),
    resolveAddr: vi.fn(async (_resolver: Address, name: string) => s.addrByName[name] ?? s.addr),
    reverseName: vi.fn(async (_r: Address, wallet: Address) => s.reverse[wallet.toLowerCase()] ?? ""),
    resolveUniversal: vi.fn(async (name: string, keys: string[]) => {
      if (s.universal instanceof Error) throw s.universal;
      return {
        ...s.universal,
        texts: Object.fromEntries(keys.map((k) => [k, s.texts[`${name}/${k}`] ?? s.texts[k] ?? ""])),
      };
    }),
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
    primaryName: vi.fn(async () => s.primary),
    recordFor: vi.fn(async (wallet: Address, domain: string) =>
      s.byWallet.find((r) => r.domain === domain && r.wallet.toLowerCase() === wallet.toLowerCase())
    ),
    preflight: vi.fn(async () => s.preflight),
    domainReady: vi.fn(
      async (domain: string) => s.ready[domain] ?? { initialised: true, active: true, registrarOk: true }
    ),
    indexStatus: vi.fn(() => ({
      indexedBlock: 1_000,
      head: 1_000,
      records: s.byWallet.length,
      synced: true,
    })),
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

  it("explains a config failure variable by variable", () => {
    const err = (() => {
      try {
        loadConfig({ ...baseEnv, RPC_URL: undefined, MULTIPASS: "nope" });
        return undefined;
      } catch (e) {
        return e;
      }
    })();
    expect(explainConfigError(err)).toEqual(["RPC_URL: missing", "MULTIPASS: Invalid"]);
    expect(explainConfigError(new Error("boom"))).toEqual(["boom"]);
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
    expect(await res.json()).toMatchObject({
      ok: true,
      relayer: chain.relayer,
      chainId: 31337,
      index: { indexedBlock: 1_000, head: 1_000, records: 0, synced: true },
    });
  });

  it("reports the addresses it was configured with, and which secrets are set", async () => {
    // Half of every deployment problem is an environment variable pointing at the wrong contract, so
    // the health endpoint says what this process is actually using. Values of secrets never appear.
    const { chain } = fakeChain();
    const body = await (
      await app(chain, { ...baseEnv, NAMESPACE_FACTORY: baseEnv.FACTORY, ETH_REGISTRY: baseEnv.BRIDGE })
    )
      .request("/healthz")
      .then((r) => r.json());

    expect(body.config).toMatchObject({
      chainId: 31337,
      multipass: baseEnv.MULTIPASS,
      bridge: baseEnv.BRIDGE,
      factory: baseEnv.FACTORY,
      namespaceFactory: baseEnv.FACTORY,
      ethRegistry: baseEnv.BRIDGE,
      nameDomains: ["kju-is", "uni"],
    });
    expect(body.config.secrets).toMatchObject({ registrarKey: true, viewcodeKey: true, relayerKey: true });
    // What is not set is as useful as what is, and no value is ever echoed.
    expect(body.config.missing).toContain("UNIVERSAL_RESOLVER");
    expect(JSON.stringify(body)).not.toContain(baseEnv.RELAYER_KEY);
    expect(JSON.stringify(body)).not.toContain("rpcUrl");
  });

  it("GET /v1/instances lists instances with the contracts a wallet writes to", async () => {
    const { chain } = fakeChain();
    const res = await app(chain).request("/v1/instances");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      instances: [instance, xInstance],
      bridge: baseEnv.BRIDGE,
      permissionedResolver: null,
      // The registry the bridge checks for "bring your own .eth"; null when none is configured.
      ethRegistry: null,
      // The browser registers a name itself: the registrar mints only to its caller.
      ethRegistrar: null,
      paymentToken: null,
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
      ready: true,
      reason: null,
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

  it("refuses before signing when the domain cannot be written", async () => {
    const cases: [{ initialised: boolean; active: boolean; registrarOk: boolean }, string][] = [
      [
        { initialised: false, active: false, registrarOk: true },
        'domain "x" is not initialised on Multipass',
      ],
      [{ initialised: true, active: false, registrarOk: true }, 'domain "x" is not active on Multipass'],
      [{ initialised: true, active: true, registrarOk: false }, 'this attester is not the registrar for "x"'],
    ];
    for (const [ready, error] of cases) {
      const { chain, submitted } = fakeChain({ ready: { x: ready } });
      const res = await post(app(chain), "/v1/attest", await wireRequest());
      expect(res.status).toBe(503);
      expect((await res.json()).error).toBe(error);
      // Nothing was signed and nothing was sent.
      expect(submitted).toHaveLength(0);
    }
  });

  it("allows a vouch domain that does not exist yet, because the relay creates it", async () => {
    const { chain } = fakeChain({
      ready: { "~carol": { initialised: false, active: false, registrarOk: true } },
    });
    const idToken = privy.mint({ sub: user.did, linked: user.linked, now: NOW });
    const wire = toWire(
      await signedAttestRequest(
        user.account,
        baseIntent(user.account, NOW, {
          domain: "~carol",
          handle: "acme-university",
          payload: toBytes32("graduated 2021"),
          exp: BigInt(NOW + 600),
        }),
        idToken,
        31337,
        baseEnv.MULTIPASS as Hex,
        await signedInvite(user.account, "carol", NOW, 31337, baseEnv.MULTIPASS as Hex)
      )
    );
    const res = await post(app(chain), "/v1/attest", wire);
    // The readiness gate lets it through; the invite check is what decides from here.
    expect(res.status).not.toBe(503);
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
      branch: "open",
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
        // The flat mount has no private branch, so a masked account there has no name to offer.
        ensName: null,
        commitment: masked.payload,
        disclosed: { handle: "alice_x", platformId: "42" },
      },
      // Telegram is not mounted in this deployment, so there is no name to check either.
      { domain: "telegram", optedIn: false, ensName: null },
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
    expect(body.links).toEqual([
      { domain: "x", optedIn: true, ensName: null, commitment: viewCodeCommitment(viewCode) },
    ]);
  });
});

describe("locate", () => {
  it("matches the longest known parent and rejects nested labels", () => {
    expect(locate("alice.kju-is.eth", [instance])).toEqual({
      handle: "alice",
      instance,
      resolver: instance.resolver,
    });
    expect(locate("a.b.kju-is.eth", [instance])).toBeUndefined();
    expect(locate("kju-is.eth", [instance])).toBeUndefined();
    expect(locate("x.other.eth", [instance])).toBeUndefined();
    // A private-branch name belongs to the mirror, which answers as the person.
    expect(locate(`alice.${xComInstance.maskedParentName}`, [instance, xComInstance])).toMatchObject({
      handle: "alice",
      resolver: xComInstance.maskedResolver,
      masked: true,
    });
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

  it("lists the vouch domain's records with voucher names, liveness, standing and the letter", async () => {
    const { chain } = fakeChain({
      listed: {
        "~alice": [bobVouch, carolVouch],
        "~bob": [
          { ...carolVouch, live: true },
          { ...bobVouch, name: "dave" },
        ],
      },
      names: { "kju-is/bob": { taken: true, wallet: user.account.address, live: true } },
      instances: [instance, vouchInstance],
      texts: {
        "bob.alice.kju-is.eth/description": "Bob managed the platform team at Acme while Alice led infra.",
      },
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
          // The reference is a name of its own, in the candidate's namespace.
          ensName: "bob.alice.kju-is.eth",
          wallet: user.account.address,
          statement: "worked together 2019-22",
          validUntil: "2027-01-15T08:00:00.000Z",
          nonce: "1",
          live: true,
          // Nobody invited these in this fixture: anyone may refer anyone, and the card says which
          // references the candidate actually asked for.
          solicited: false,
          invite: null,
          letterHash: null,
          standing: { claimed: true, given: 2, received: 2 },
          letter: "Bob managed the platform team at Acme while Alice led infra.",
        },
        {
          voucher: "carol",
          voucherName: "carol.kju-is.eth",
          ensName: "carol.alice.kju-is.eth",
          wallet: zeroAddress,
          statement: "revoked",
          validUntil: "2023-11-14T22:13:20.000Z",
          nonce: "2",
          live: false,
          solicited: false,
          invite: null,
          letterHash: null,
          standing: null,
          letter: null,
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

describe("an address written with the wrong casing", () => {
  it("is normalised rather than carried until viem refuses it", async () => {
    // EIP-55 casing is a checksum. An address pasted from a explorer in lower case, or mis-cased in a
    // deployment file, is still the same address — but viem rejects it at the call, which surfaces as
    // a 502 from a read rather than as a configuration error anyone can act on.
    const lower = "0x4a1817d13e9cf196f471725176355c1234b63c70";
    const { chain } = fakeChain();
    const a = createApp({
      config: loadConfig({ ...baseEnv, UNIVERSAL_RESOLVER: lower }),
      chain,
      now: () => NOW,
    });
    const health = await (await a.request("/healthz")).json();
    expect(health.config.universalResolver).toBe("0x4A1817d13E9cF196f471725176355C1234b63C70");
  });

  it("still refuses something that is not an address at all", () => {
    expect(() => loadConfig({ ...baseEnv, UNIVERSAL_RESOLVER: "0xnope" })).toThrow();
  });
});

describe("an invitation behind a short code", () => {
  const wire = async (over: object = {}) => {
    const invite = await signedInvite(user.account, "alice", NOW, 31337, baseEnv.MULTIPASS as Hex, over);
    return { ...invite, exp: invite.exp.toString() };
  };
  const post = (app: ReturnType<typeof createApp>, body: object) =>
    app.request("/v1/invite", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("hands back a code short enough to read out, and gives the invitation back for it", async () => {
    // A base64 invitation makes a link nobody can paste into a message without it wrapping.
    const dir = mkdtempSync(join(tmpdir(), "ketsuban-invites-"));
    // Only the wallet holding the name can invite on its behalf, so the fixture has to hold it.
    const { chain } = fakeChain({
      names: { "kju-is/alice": { taken: true, wallet: user.account.address, live: true } },
    });
    const a = createApp({ config: loadConfig({ ...baseEnv, DATA_DIR: dir }), chain, now: () => NOW });

    const res = await post(a, await wire());
    const made = await res.json();
    expect(made.error ?? "").toBe("");
    expect(made.code).toMatch(/^[0-9a-z]{8}$/);

    const back = await (await a.request(`/v1/invite/${made.code}`)).json();
    expect(back.invite).toMatchObject({ handle: "alice", requires: [] });
    // The signature comes back untouched: the code is a shortcut, never a substitute for it.
    expect(back.invite.signature).toBe((await wire()).signature);
  });

  it("keeps what the candidate asked the writer to show", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ketsuban-invites-req-"));
    const { chain } = fakeChain({
      names: { "kju-is/alice": { taken: true, wallet: user.account.address, live: true } },
    });
    const a = createApp({ config: loadConfig({ ...baseEnv, DATA_DIR: dir }), chain, now: () => NOW });
    const made = await (await post(a, await wire({ requires: ["mit.edu", "linkedin.com"] }))).json();
    const back = await (await a.request(`/v1/invite/${made.code}`)).json();
    expect(back.invite.requires).toEqual(["mit.edu", "linkedin.com"]);
  });

  it("lists the invitations a candidate has made, so a link survives closing the page", async () => {
    // The link lived in component state, so a reload lost it and the candidate had to sign another.
    const dir = mkdtempSync(join(tmpdir(), "ketsuban-invites-list-"));
    const { chain } = fakeChain({
      names: { "kju-is/alice": { taken: true, wallet: user.account.address, live: true } },
    });
    const a = createApp({ config: loadConfig({ ...baseEnv, DATA_DIR: dir }), chain, now: () => NOW });
    const made = await (await post(a, await wire({ requires: ["mit.edu"] }))).json();

    const listed = await (await a.request(`/v1/invites/alice`)).json();
    expect(listed.invites).toHaveLength(1);
    expect(listed.invites[0]).toMatchObject({ code: made.code, requires: ["mit.edu"] });
    // The signature is not needed to show a link, and is nobody else's business.
    expect(JSON.stringify(listed)).not.toContain("signature");
  });

  it("leaves out an invitation that has expired, because its link no longer works", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ketsuban-invites-old-"));
    const { chain } = fakeChain({
      names: { "kju-is/alice": { taken: true, wallet: user.account.address, live: true } },
    });
    const at = (t: number) =>
      createApp({ config: loadConfig({ ...baseEnv, DATA_DIR: dir }), chain, now: () => t });
    await post(at(NOW), "/v1/invite", await wire());

    const later = at(NOW + 8 * 24 * 3600);
    expect((await (await later.request("/v1/invites/alice")).json()).invites).toEqual([]);
  });

  it("refuses an invitation nobody signed, so a code always stands for something real", async () => {
    const { chain } = fakeChain();
    const a = app(chain);
    expect((await post(a, { handle: "alice", voucher: zeroAddress, exp: "1", requires: [] })).status).toBe(
      400
    );
  });

  it("says a code it does not hold is unknown, rather than answering with nothing", async () => {
    const { chain } = fakeChain();
    expect((await app(chain).request("/v1/invite/zzzzzzzz")).status).toBe(404);
  });
});

describe("a letter too long to sit on chain", () => {
  const long = "Alice ran infrastructure at Acme for three years. ".repeat(30);
  const post = (app: ReturnType<typeof createApp>, body: object) =>
    app.request("/v1/letter", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("keeps the text by its own hash, and hands back the pointer a record can hold", async () => {
    // A name holds 31 bytes and a text record costs gas by the byte. The letter lives here; what goes
    // on chain is the hash of it, which is what makes the copy checkable rather than trusted.
    const dir = mkdtempSync(join(tmpdir(), "ketsuban-letters-"));
    const { chain } = fakeChain();
    const a = createApp({ config: loadConfig({ ...baseEnv, DATA_DIR: dir }), chain, now: () => NOW });

    const stored = await (await post(a, { text: long })).json();
    expect(stored.ref).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(stored.hash).toBe(stored.ref.slice("sha256:".length));

    const read = await (await a.request(`/v1/letter/${stored.hash}`)).json();
    expect(read.text).toBe(long);
    // Anyone can check the copy they were given is the one the record names.
    expect(createHash("sha256").update(long).digest("hex")).toBe(stored.hash);
  });

  it("stores one copy of the same letter, however many times it is written", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ketsuban-letters-same-"));
    const { chain } = fakeChain();
    const a = createApp({ config: loadConfig({ ...baseEnv, DATA_DIR: dir }), chain, now: () => NOW });
    const one = await (await post(a, { text: long })).json();
    const two = await (await post(a, { text: long })).json();
    expect(one.hash).toBe(two.hash);
  });

  it("refuses an empty letter and one nobody could be asked to read", async () => {
    const { chain } = fakeChain();
    const a = app(chain);
    expect((await post(a, { text: "" })).status).toBe(400);
    expect((await post(a, { text: "x".repeat(20_001) })).status).toBe(413);
  });

  it("stops taking letters before an unauthenticated caller can fill the disk", async () => {
    // Nothing gates this endpoint, and the same directory holds the grants and the avatars. Without a
    // ceiling, anyone could take the whole deployment down by writing letters nobody asked for.
    const dir = mkdtempSync(join(tmpdir(), "ketsuban-letters-full-"));
    const { chain } = fakeChain();
    const a = createApp({
      config: loadConfig({ ...baseEnv, DATA_DIR: dir, LETTER_STORE_BYTES: "4000" }),
      chain,
      now: () => NOW,
    });

    // Each letter is distinct, so content-addressing cannot dedupe the pressure away.
    for (let i = 0; i < 2; i++) {
      expect((await post(a, { text: `${i} ${"x".repeat(1_500)}` })).status).toBe(200);
    }
    const full = await post(a, { text: `over ${"y".repeat(1_500)}` });
    expect(full.status).toBe(507);
    expect((await full.json()).error).toMatch(/full/i);

    // A letter already held is still readable: the ceiling refuses new writes, it does not lose old ones.
    const first = createHash("sha256")
      .update(`0 ${"x".repeat(1_500)}`)
      .digest("hex");
    expect((await a.request(`/v1/letter/${first}`)).status).toBe(200);
  });

  it("says a letter it does not hold is missing, rather than answering with nothing", async () => {
    const { chain } = fakeChain();
    const missing = await app(chain).request(`/v1/letter/${"ab".repeat(32)}`);
    expect(missing.status).toBe(404);
  });

  it("resolves the pointer on a reference, and says the copy matches the hash on chain", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ketsuban-letters-vouch-"));
    const { chain } = fakeChain({
      listed: {
        "~alice": [
          {
            name: "bob",
            id: toBytes32("b"),
            wallet: user.account.address,
            payload: toBytes32("worked together"),
            validUntil: 1_800_000_000n,
            nonce: 1n,
            live: true,
          },
        ],
      },
      instances: [instance, vouchInstance],
      // The key the fake resolver answers on: `<name>/<key>`.
      texts: {
        "bob.alice.kju-is.eth/description": `sha256:${createHash("sha256").update(long).digest("hex")}`,
      },
    });
    const a = createApp({ config: loadConfig({ ...baseEnv, DATA_DIR: dir }), chain, now: () => NOW });
    await post(a, { text: long });

    const listed = await (await a.request("/v1/vouches/alice")).json();
    const bob = listed.vouches.find((v: { voucher: string }) => v.voucher === "bob");
    expect(bob.letter).toBe(long);
    expect(bob.letterHash).toBe(createHash("sha256").update(long).digest("hex"));
  });
});

describe("GET /v1/instance/:domain — what people said under one name", () => {
  const answer = (name: string, payload: string) => ({
    name,
    id: toBytes32(name),
    wallet: user.account.address,
    payload: toBytes32(payload),
    validUntil: 1_800_000_000n,
    nonce: 1n,
    live: true,
  });

  it("lists the answers published under it, which is what the name is for", async () => {
    // `kju-is.ketsuban.eth` is not an unclaimed person: it is where answers about one are published.
    // Reporting "no record" there hides every answer anyone wrote.
    const { chain } = fakeChain({
      listed: { "kju-is": [answer("alice", "terrible dictator"), answer("bob", "no comment")] },
      texts: { "kju-is.eth/description": "Answering tests affiliation with North Korean operators." },
    });
    const body = await (await app(chain).request("/v1/instance/kju-is")).json();
    expect(body).toMatchObject({ domain: "kju-is", parentName: "kju-is.eth" });
    expect(body.answers).toHaveLength(2);
    expect(body.answers[0]).toMatchObject({
      handle: "alice",
      answer: "terrible dictator",
      ensName: "alice.kju-is.eth",
    });
    // The purpose is published on the name itself, so it travels with the answers.
    expect(body.description).toMatch(/North Korean/);
  });

  it("reads the page's own text the way ENS does, not through the instance's resolver", async () => {
    // `kju-is.<root>` is answered by the parent's resolver — the instance has none of its own in the
    // registry — so reading through the instance's resolver finds nothing however the record was set.
    const { chain } = fakeChain({
      // Keyed by the name, as the universal read answers it.
      texts: {
        "kju-is.eth/description": "Kim Jong Un, Supreme Leader of North Korea.",
        "kju-is.eth/url": "https://t.example",
      },
      listed: { "kju-is": [] },
    });
    const body = await (await app(chain).request("/v1/instance/kju-is")).json();
    expect(body.records.description).toMatch(/Supreme Leader/);
    expect(body.records.url).toBe("https://t.example");
  });

  it("shows who the page is about, from the records the name itself holds", async () => {
    // A page created for someone who has claimed nothing is only worth reading if it says who they
    // are. That belongs on the name, where any ENS client reads it, not in this app.
    const { chain } = fakeChain({
      listed: { "kju-is": [] },
      texts: {
        "kju-is.eth/description": "Supreme Leader of North Korea.",
        "kju-is.eth/url": "https://en.wikipedia.org/wiki/Kim_Jong_Un",
        "kju-is.eth/avatar": "https://example.test/kju.png",
      },
    });
    const body = await (await app(chain).request("/v1/instance/kju-is")).json();
    expect(body.records).toEqual({
      description: "Supreme Leader of North Korea.",
      url: "https://en.wikipedia.org/wiki/Kim_Jong_Un",
      avatar: "https://example.test/kju.png",
    });
  });

  it("says an instance nobody mounted is not here, rather than answering with an empty list", async () => {
    const { chain } = fakeChain();
    expect((await app(chain).request("/v1/instance/nowhere")).status).toBe(404);
  });

  it("leaves out an answer that has lapsed, because it no longer says anything", async () => {
    const { chain } = fakeChain({
      listed: { "kju-is": [{ ...answer("alice", "terrible dictator"), live: false }] },
    });
    const body = await (await app(chain).request("/v1/instance/kju-is")).json();
    expect(body.answers).toEqual([]);
  });
});

describe("GET /v1/who — finding a person by an account", () => {
  const bobOnX = {
    name: "bob",
    id: toBytes32("bx"),
    wallet: user.account.address,
    payload: zeroHash,
    validUntil: 1_800_000_000n,
    nonce: 1n,
    live: true,
  };

  it("finds whoever attested an account publicly, and names their page", async () => {
    const { chain } = fakeChain({
      listed: { "x.com": [bobOnX] },
      byWallet: [{ ...bobOnX, domain: "kju-is", name: "bobby" }],
    });
    const found = await (await app(chain).request("/v1/who?domain=x.com&handle=bob")).json();
    expect(found).toMatchObject({
      found: true,
      domain: "x.com",
      handle: "bob",
      wallet: user.account.address,
      // The person, not the account: a reference is written for whoever holds the account.
      candidate: "bobby",
    });
  });

  it("cannot find someone who attested privately, and says why rather than saying nobody", async () => {
    // A masked record stores a one-time pad, so searching by handle cannot match it. Reporting this as
    // "not found" would invite writing a second page for a person who already has one.
    const masked = { ...bobOnX, name: maskName("bob", `0x${"5a".repeat(32)}`), payload: toBytes32("c") };
    const { chain } = fakeChain({ listed: { "x.com": [masked] } });
    const res = await (await app(chain).request("/v1/who?domain=x.com&handle=bob")).json();
    expect(res.found).toBe(false);
    expect(res.note).toMatch(/private/i);
  });

  it("finds a private account for whoever holds its view code", async () => {
    // A view code is 32 bytes the candidate chose to hand over, so holding it is the permission. With
    // it the masked name can be computed and matched exactly — no scanning, and nothing to guess.
    const viewCode = `0x${"5a".repeat(32)}` as Hex;
    // The chain holds the pad; the index also decodes it, which is lossy — so a lookup matches on the
    // raw bytes, and the fixture has to carry them the way a real record does.
    const masked = {
      ...bobOnX,
      name: "\ufffd\ufffd garbled",
      rawName: maskName("bob", viewCode),
      payload: viewCodeCommitment(viewCode),
    };
    const { chain } = fakeChain({
      listed: { "x.com": [masked] },
      byWallet: [{ ...bobOnX, domain: "kju-is", name: "bobby" }],
    });
    const a = app(chain);

    const found = await (await a.request(`/v1/who?domain=x.com&handle=bob&viewCode=${viewCode}`)).json();
    expect(found).toMatchObject({ found: true, candidate: "bobby" });

    // The wrong code computes a different mask and matches nothing: the code is the whole gate.
    const wrong = await (
      await a.request(`/v1/who?domain=x.com&handle=bob&viewCode=0x${"11".repeat(32)}`)
    ).json();
    expect(wrong.found).toBe(false);
    // And without one, the same account is unfindable, as it must be.
    expect((await (await a.request("/v1/who?domain=x.com&handle=bob")).json()).found).toBe(false);
  });

  it("refuses a view code that is not one", async () => {
    const { chain } = fakeChain({ listed: { "x.com": [] } });
    expect((await app(chain).request("/v1/who?domain=x.com&handle=bob&viewCode=nope")).status).toBe(400);
  });

  it("says nothing was found for an account nobody has attested", async () => {
    const { chain } = fakeChain({ listed: { "x.com": [] } });
    const res = await (await app(chain).request("/v1/who?domain=x.com&handle=nobody")).json();
    expect(res).toMatchObject({ found: false, domain: "x.com", handle: "nobody" });
  });

  it("refuses a search that names no account", async () => {
    const { chain } = fakeChain();
    expect((await app(chain).request("/v1/who?domain=x.com")).status).toBe(400);
  });
});

describe("GET /v1/find — telling two people of the same name apart", () => {
  const person = (name: string) => ({
    name,
    id: toBytes32(name),
    wallet: user.account.address,
    payload: zeroHash,
    validUntil: 1_800_000_000n,
    nonce: 1n,
    live: true,
  });
  const vouch = (voucher: string) => ({ ...person(voucher), id: toBytes32(`v-${voucher}`) });

  it("ranks people of a similar name by how many references they have received", async () => {
    // Nothing enforces which `bob` is the real one. The one people have actually vouched for is the
    // one they mean, and that becomes truer over time rather than being decided up front.
    const { chain } = fakeChain({
      listed: {
        "kju-is": [person("bob"), person("bobby"), person("bob-the-second")],
        "~bob": [vouch("carol")],
        "~bobby": [vouch("carol"), vouch("dave"), vouch("erin")],
        "~bob-the-second": [],
      },
      names: {
        "kju-is/bob": { taken: true, wallet: user.account.address, live: true },
        "kju-is/bobby": { taken: true, wallet: user.account.address, live: true },
        "kju-is/bob-the-second": { taken: true, wallet: user.account.address, live: true },
      },
    });
    const found = await (await app(chain).request("/v1/find?q=bob")).json();
    expect(found.matches.map((m: { handle: string }) => m.handle)).toEqual([
      "bobby",
      "bob",
      "bob-the-second",
    ]);
    expect(found.matches[0]).toMatchObject({ handle: "bobby", received: 3 });
  });

  it("matches on what was typed, not on everything in the domain", async () => {
    const { chain } = fakeChain({ listed: { "kju-is": [person("bob"), person("carol")] } });
    const found = await (await app(chain).request("/v1/find?q=car")).json();
    expect(found.matches.map((m: { handle: string }) => m.handle)).toEqual(["carol"]);
  });

  it("answers with nothing to pick rather than an error when the name is new", async () => {
    const { chain } = fakeChain({ listed: { "kju-is": [person("bob")] } });
    const found = await (await app(chain).request("/v1/find?q=zebedee")).json();
    expect(found).toEqual({ q: "zebedee", matches: [] });
  });

  it("refuses a search too short to mean anything", async () => {
    const { chain } = fakeChain();
    expect((await app(chain).request("/v1/find?q=a")).status).toBe(400);
  });
});

describe("POST /v1/attest — vouch invitations", () => {
  const vouchIntent = (now: number) =>
    baseIntent(user.account, now, {
      domain: "~alice",
      handle: "bob",
      payload: toBytes32("worked together"),
      exp: BigInt(now + 600),
    });

  /** Alice holds her name, so her wallet is the one that may invite vouchers. */
  const aliceHolds = { names: { "kju-is/alice": { taken: true, wallet: user.account.address, live: true } } };

  it("takes a statement from anyone, and remembers which ones the candidate asked for", async () => {
    // Non-permissioned: a reference nobody asked for is still a reference, and it says so.
    const { chain } = fakeChain(aliceHolds);
    const a = app(chain);
    const idToken = privy.mint({ sub: user.did, linked: user.linked, now: NOW });

    const bare = toWire(
      await signedAttestRequest(user.account, vouchIntent(NOW), idToken, 31337, baseEnv.MULTIPASS as Hex)
    );
    const uninvited = await post(a, "/v1/attest", bare);
    expect(uninvited.status).toBe(200);
    expect((await uninvited.json()).record.domainName).toBe(toBytes32("~alice"));

    const invited = toWire(
      await signedAttestRequest(
        user.account,
        vouchIntent(NOW),
        idToken,
        31337,
        baseEnv.MULTIPASS as Hex,
        await signedInvite(user.account, "alice", NOW, 31337, baseEnv.MULTIPASS as Hex)
      )
    );
    const ok = await post(a, "/v1/attest", invited);
    expect(ok.status).toBe(200);
    expect((await ok.json()).record.domainName).toBe(toBytes32("~alice"));
    expect(chain.nameStatus).toHaveBeenCalledWith("kju-is", "alice");
  });

  it("lets an onboarded organisation write for a handle nobody has claimed", async () => {
    const orgKey = `${user.account.address.toLowerCase()}:org`;
    const { chain } = fakeChain({
      // No record for alice: the candidate does not exist yet, and this wallet holds an org record.
      records: { [orgKey]: { exists: true, nonce: 1n, id: toBytes32("acme"), wallet: user.account.address } },
    });
    const now = NOW;
    const wire = toWire(
      await signedAttestRequest(
        user.account,
        baseIntent(user.account, now, {
          domain: "~alice",
          handle: "acme-university",
          payload: toBytes32("graduated 2021"),
          exp: BigInt(now + 600),
        }),
        privy.mint({ sub: user.did, linked: user.linked, now }),
        31337,
        baseEnv.MULTIPASS as Hex
      )
    );
    const res = await post(app(chain), "/v1/attest", wire);
    const body = await res.json();
    expect(body.error ?? "").toBe("");
    expect(res.status).toBe(200);
    expect(body.record.name).toBe(toBytes32("acme-university"));
    expect(chain.readOnchain).toHaveBeenCalledWith(user.account.address, "org");
  });

  it("marks a reference the candidate invited, and carries the invitation for a reader to check", async () => {
    const written = {
      name: "bob",
      id: toBytes32("b"),
      wallet: user.account.address,
      payload: toBytes32("worked together 2019-22"),
      validUntil: 1_800_000_000n,
      nonce: 1n,
      live: true,
    };
    const { chain } = fakeChain({ ...aliceHolds, listed: { "~alice": [written] } });
    const a = app(chain);
    const invite = await signedInvite(user.account, "alice", NOW, 31337, baseEnv.MULTIPASS as Hex);
    const wire = toWire(
      await signedAttestRequest(
        user.account,
        { ...vouchIntent(NOW), handle: "bob" },
        privy.mint({ sub: user.did, linked: user.linked, now: NOW }),
        31337,
        baseEnv.MULTIPASS as Hex,
        invite
      )
    );
    expect((await post(a, "/v1/attest", wire)).status).toBe(200);

    const listed = await (await a.request("/v1/vouches/alice")).json();
    const bob = listed.vouches.find((v: { voucher: string }) => v.voucher === "bob");
    expect(bob.solicited).toBe(true);
    // The signature travels with it: a verifier recovers the signer themselves rather than trusting us.
    expect(bob.invite).toMatchObject({ handle: "alice", signature: invite.signature });
  });

  it("does not count an invitation signed by someone who does not hold the candidate's name", async () => {
    const { chain } = fakeChain(aliceHolds);
    const idToken = privy.mint({ sub: user.did, linked: user.linked, now: NOW });
    const wire = toWire(
      await signedAttestRequest(
        user.account,
        vouchIntent(NOW),
        idToken,
        31337,
        baseEnv.MULTIPASS as Hex,
        await signedInvite(registrar, "alice", NOW, 31337, baseEnv.MULTIPASS as Hex)
      )
    );
    // Anyone can sign an "invitation" from themselves; only the wallet holding alice's name counts.
    // The reference is still written — it simply does not get to claim she asked for it.
    const res = await post(app(chain), "/v1/attest", wire);
    expect(res.status).toBe(200);
    const listed = await (await app(chain).request("/v1/vouches/alice")).json();
    expect(listed.vouches.every((v: { solicited: boolean }) => !v.solicited)).toBe(true);
  });

  it("a deployment may switch invitations back on", async () => {
    const { chain } = fakeChain(aliceHolds);
    const open = createApp({
      config: loadConfig({ ...baseEnv, REQUIRE_INVITE: "true" }),
      chain,
      now: () => NOW,
    });
    const wire = toWire(
      await signedAttestRequest(
        user.account,
        vouchIntent(NOW),
        privy.mint({ sub: user.did, linked: user.linked, now: NOW }),
        31337,
        baseEnv.MULTIPASS as Hex
      )
    );
    // Closed again: the uninvited are refused, as a deployment that asked for that expects.
    const refused = await post(open, "/v1/attest", wire);
    expect(refused.status).toBe(422);
    expect((await refused.json()).error).toContain("needs the candidate's invitation");
  });
});

describe("GET /v1/nonce — readiness", () => {
  it("tells the browser not to sign for a domain that cannot be written", async () => {
    const cases: [string, { initialised: boolean; active: boolean; registrarOk: boolean }, string][] = [
      [
        "google",
        { initialised: false, active: false, registrarOk: true },
        'domain "google" is not initialised on Multipass',
      ],
      [
        "github",
        { initialised: true, active: false, registrarOk: true },
        'domain "github" is not active on Multipass',
      ],
      [
        "x",
        { initialised: true, active: true, registrarOk: false },
        'this attester is not the registrar for "x"',
      ],
    ];
    for (const [domain, ready, reason] of cases) {
      const { chain } = fakeChain({ ready: { [domain]: ready } });
      const body = await (
        await app(chain).request(`/v1/nonce?wallet=${user.account.address}&domain=${domain}`)
      ).json();
      expect(body.ready).toBe(false);
      expect(body.reason).toBe(reason);
      // The nonce is still reported: the browser shows why, it does not lose its place.
      expect(body.next).toBe("1");
    }
  });
});

describe("POST /v1/submit", () => {
  it("creates the vouch instance a reference needs when the candidate has no name yet", async () => {
    const { chain, state, submitted } = fakeChain();
    const record = {
      name: toBytes32("acme-university"),
      id: toBytes32("acme"),
      domainName: toBytes32("~nobody"),
      validUntil: String(NOW + 3600),
      nonce: "1",
      wallet: user.account.address,
      payload: toBytes32("graduated 2021"),
    };
    const res = await post(app(chain), "/v1/submit", { record, signature: "0xabc" });
    expect(res.status).toBe(200);
    // The instance follows the signed record: an organisation writes before the candidate exists.
    expect(state.instancesCreated).toEqual(["nobody"]);
    expect(submitted).toHaveLength(1);

    // A name claimed in the root domain provisions that person's own vouch instance, so somebody can
    // refer them straight away rather than only after the first reference arranges it.
    const claimed = fakeChain();
    await post(app(claimed.chain), "/v1/submit", {
      record: { ...record, domainName: toBytes32("kju-is") },
      signature: "0xabc",
    });
    expect(claimed.state.instancesCreated).toEqual(["acme-university"]);
  });

  it("relays a registrar-signed record with no token, and reports a chain failure", async () => {
    const { chain, submitted } = fakeChain();
    const attested = await (await post(app(chain), "/v1/attest", await wireRequest())).json();
    const res = await post(app(chain), "/v1/submit", attested);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
    expect(submitted).toHaveLength(1);
    expect(submitted[0].record.domainName).toBe(toBytes32("x"));

    expect((await post(app(chain), "/v1/submit", { nope: true })).status).toBe(400);

    const broken = fakeChain();
    broken.chain.submit = vi.fn(async () => {
      throw new Error("verify reverted");
    });
    const failed = await post(app(broken.chain), "/v1/submit", attested);
    expect(failed.status).toBe(502);
    expect((await failed.json()).error).toBe("verify reverted");
  });
});

describe("POST /v1/org", () => {
  const orgApp = (chain: ChainReader) =>
    createApp({
      config: loadConfig({ ...baseEnv, ORG_TOKEN: "0123456789abcdef0123456789abcdef" }),
      chain,
      now: () => NOW,
    });
  const token = { "x-org-token": "0123456789abcdef0123456789abcdef" };
  const body = { wallet: user.account.address, label: "acme-university" };

  it("signs an org record the contract accepts, and renews rather than duplicating", async () => {
    const { chain, submitted } = fakeChain();
    const res = await post(orgApp(chain), "/v1/org", body, token);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, label: "acme-university", renewal: false });

    const [written] = submitted;
    expect(written.record).toMatchObject({
      name: toBytes32("acme-university"),
      domainName: toBytes32("org"),
      wallet: user.account.address,
      nonce: 1n,
    });
    // The signature has to come from the registrar, or Multipass rejects it.
    expect(
      await recoverTypedDataAddress({
        domain: {
          name: baseEnv.MULTIPASS_EIP712_NAME ?? "MultipassDNS",
          version: "1.0.0",
          chainId: 31337,
          verifyingContract: baseEnv.MULTIPASS as Hex,
        },
        types: registerNameTypes,
        primaryType: "registerName",
        message: written.record,
        signature: written.signature,
      })
    ).toBe(registrar.address);

    const held = `${user.account.address.toLowerCase()}:org`;
    const existing = fakeChain({
      records: { [held]: { exists: true, nonce: 3n, id: toBytes32("acme"), wallet: user.account.address } },
    });
    const renewed = await post(orgApp(existing.chain), "/v1/org", body, token);
    expect(await renewed.json()).toMatchObject({ renewal: true });
    expect(existing.submitted[0].record.nonce).toBe(4n);
  });

  it("is operator-only, validates its input, and refuses when the domain is not usable", async () => {
    const { chain } = fakeChain();
    expect((await post(app(chain), "/v1/org", body, token)).status).toBe(501);
    expect((await post(orgApp(chain), "/v1/org", body)).status).toBe(401);
    expect((await post(orgApp(chain), "/v1/org", { wallet: "nope", label: "acme" }, token)).status).toBe(400);
    expect(
      (await post(orgApp(chain), "/v1/org", { wallet: body.wallet, label: "Not Valid" }, token)).status
    ).toBe(400);

    const wrong = fakeChain({ ready: { org: { initialised: true, active: true, registrarOk: false } } });
    const res = await post(orgApp(wrong.chain), "/v1/org", body, token);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain('not the registrar for "org"');
  });
});

describe("the two ways a signed record is delivered", () => {
  const rootRecord = () => ({
    record: {
      name: toBytes32("alice"),
      id: toBytes32("a"),
      domainName: toBytes32("kju-is"),
      validUntil: String(NOW + 3600),
      nonce: "1",
      wallet: user.account.address,
      payload: zeroHash,
    },
    signature: `0x${"11".repeat(65)}` as Hex,
  });

  it("provisions the same things whichever route delivered the record", async () => {
    // The browser posts to /v1/submit and the enclave to /v1/cre/delivery. They write the same record,
    // so anything one of them arranges the other has to arrange too — a claim that provisions a vouch
    // instance on one path and not the other is a person nobody can refer until someone else tries.
    const browser = fakeChain();
    expect((await post(app(browser.chain), "/v1/submit", rootRecord())).status).toBe(200);

    const enclave = fakeChain();
    const viaEnclave = await app(enclave.chain).request("/v1/cre/delivery", {
      method: "POST",
      headers: { "content-type": "application/json", "x-delivery-token": baseEnv.DELIVERY_TOKEN as string },
      body: JSON.stringify(rootRecord()),
    });
    expect(viaEnclave.status).toBe(200);

    expect(browser.chain.ensureVouchInstance).toHaveBeenCalledWith("alice");
    expect(enclave.chain.ensureVouchInstance).toHaveBeenCalledWith("alice");
  });
});

describe("POST /v1/provision", () => {
  it("provisions the vouch instance for a live handle, is idempotent, and refuses the rest", async () => {
    const { chain, state } = fakeChain({
      names: { "kju-is/alice": { taken: true, wallet: user.account.address, live: true } },
    });
    const a = app(chain);
    expect(await (await post(a, "/v1/provision", { handle: "alice" })).json()).toEqual({
      handle: "alice",
      domain: "~alice",
      created: true,
    });
    expect(await (await post(a, "/v1/provision", { handle: "alice" })).json()).toEqual({
      handle: "alice",
      domain: "~alice",
      created: false,
    });
    expect(state.instancesCreated).toEqual(["alice"]);

    expect((await post(a, "/v1/provision", { handle: "Not Valid" })).status).toBe(400);
    const unclaimed = await post(a, "/v1/provision", { handle: "nobody" });
    expect(unclaimed.status).toBe(403);
    expect((await unclaimed.json()).error).toContain("nobody.kju-is holds no live record");
  });

  it("502s when provisioning fails on chain", async () => {
    const { chain } = fakeChain({
      names: { "kju-is/alice": { taken: true, wallet: user.account.address, live: true } },
    });
    chain.ensureVouchInstance = vi.fn(async () => {
      throw new Error("relayer does not own the factory");
    });
    const res = await post(app(chain), "/v1/provision", { handle: "alice" });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("relayer does not own the factory");
  });
});

describe("GET /v1/preflight", () => {
  it("reports a healthy deployment, and 503s with the reason when something is off", async () => {
    const { chain } = fakeChain();
    const res = await app(chain).request("/v1/preflight");
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);

    const broken = fakeChain({
      preflight: {
        ok: false,
        bridge: { address: baseEnv.BRIDGE as Address, deployed: true, missing: ["verify"] },
        multipass: { address: baseEnv.MULTIPASS as Address, deployed: true, domains: [] },
        factory: { address: baseEnv.FACTORY as Address, deployed: false, instances: [] },
        namespaceFactory: null,
        registrar: { signsAs: registrar.address, onchain: [] },
        relayer: { address: registrar.address, balance: "0" },
        warnings: ["BRIDGE has no verify(): it predates this build"],
      },
    });
    const bad = await app(broken.chain).request("/v1/preflight");
    expect(bad.status).toBe(503);
    // The chain's own warnings come first; this deployment keeps nothing on disk, which is its own.
    expect((await bad.json()).warnings[0]).toBe("BRIDGE has no verify(): it predates this build");

    const thrown = fakeChain();
    thrown.chain.preflight = vi.fn(async () => {
      throw new Error("rpc unreachable");
    });
    const failed = await app(thrown.chain).request("/v1/preflight");
    expect(failed.status).toBe(502);
    expect((await failed.json()).warnings).toEqual(["rpc unreachable"]);
  });
});

describe("GET /v1/profile/:handle", () => {
  it("returns every instance name, the references and the standing in one read", async () => {
    const { chain } = fakeChain({
      addr: user.account.address,
      instances: [instance, { ...instance, domain: "uni", parentName: "uni.eth", parentLabel: "uni" }],
      names: { "kju-is/alice": { taken: true, wallet: user.account.address, live: true } },
      texts: {
        "alice.kju-is.eth/ketsuban:answer": "terrible dictator",
        "alice.uni.eth/ketsuban:answer": "computer science",
      },
      listed: {
        "~alice": [
          {
            name: "bob",
            id: toBytes32("b"),
            wallet: user.account.address,
            payload: toBytes32("worked together"),
            validUntil: 1_800_000_000n,
            nonce: 1n,
            live: true,
          },
        ],
      },
    });
    const res = await app(chain).request("/v1/profile/Alice?links=x");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.handle).toBe("alice");
    expect(body.names.map((n: { instance: string; name: string }) => [n.instance, n.name])).toEqual([
      ["kju-is", "alice.kju-is.eth"],
      ["uni", "alice.uni.eth"],
    ]);
    expect(body.names[0].verification.answer).toBe("terrible dictator");
    expect(body.names[1].verification.answer).toBe("computer science");
    expect(body.names[0].verification.status).toBe("active");
    expect(body.vouches).toHaveLength(1);
    expect(body.vouches[0]).toMatchObject({ voucher: "bob", statement: "worked together", live: true });
    expect(body.standing).toEqual({ claimed: true, given: 0, received: 1 });
    // Facts only: the API never grades a person.
    expect(body.score).toBeUndefined();
    expect(body.complete).toBeUndefined();
    expect(body.warning).toBe(WARNING);
  });

  it("matches /v1/verify for the same name, and 400s a bad handle", async () => {
    const { chain } = fakeChain({
      addr: user.account.address,
      names: { "kju-is/alice": { taken: true, wallet: user.account.address, live: true } },
      texts: { "alice.kju-is.eth/ketsuban:answer": "terrible dictator" },
    });
    const a = app(chain);
    const profile = await (await a.request("/v1/profile/alice")).json();
    const single = await (await a.request("/v1/verify/alice.kju-is.eth")).json();
    expect(profile.names[0].verification).toEqual(single);
    expect((await a.request("/v1/profile/Not%20Valid")).status).toBe(400);
  });
});

describe("disclosing a masked account", () => {
  const ENCLAVE = registrar; // the registrar key is the enclave key
  const aliceName = "alice.kju-is.eth";

  /** A masked x record for alice, exactly as the attester writes one. */
  function maskedChain(addrByName: Record<string, Address> = {}) {
    const viewCode = `0x${"5a".repeat(32)}` as Hex;
    const record = {
      name: maskName("alice_x", viewCode),
      id: maskId("1234567890", viewCode),
      payload: viewCodeCommitment(viewCode),
    };
    const packed = `0x${record.name.slice(2)}${record.id.slice(2)}${record.payload.slice(2)}` as Hex;
    const { chain } = fakeChain({
      addr: user.account.address,
      addrByName,
      data: { [`ketsuban:link:x`]: packed },
    });
    return { chain, viewCode };
  }

  async function grantFor(
    viewCode: Hex,
    over: Partial<{ audience: Address; exp: bigint; domains: string[]; audienceName: string }> = {}
  ) {
    const domains = over.domains ?? ["x"];
    // A fresh seed per box, as the browser does: two grants of the same account are two permissions,
    // and a fixed seed would give them one id and make the second replace the first.
    const boxes = domains.map(() =>
      eciesEncrypt(ENCLAVE.publicKey, hexToBytes(viewCode), crypto.getRandomValues(new Uint8Array(32)))
    );
    const disclosure = {
      name: aliceName,
      domains,
      audience: (over.audience ?? zeroAddress) as Address,
      audienceName: over.audienceName ?? "",
      exp: over.exp ?? BigInt(NOW + 3600),
      boxesHash: hashBoxes(boxes),
    };
    const signature = await signDisclosure(
      user.account,
      disclosure,
      discloseDomain(31337, baseEnv.MULTIPASS as Hex)
    );
    return {
      ...disclosure,
      exp: disclosure.exp.toString(),
      boxes,
      signature,
    };
  }

  async function revokeFor(over: Partial<{ at: bigint; signer: typeof user.account; grantId: Hex }> = {}) {
    const revocation = {
      name: aliceName,
      grantId: over.grantId ?? (`0x${"00".repeat(32)}` as Hex),
      at: over.at ?? BigInt(NOW),
    };
    const signature = await signRevocation(
      over.signer ?? user.account,
      revocation,
      discloseDomain(31337, baseEnv.MULTIPASS as Hex)
    );
    return { ...revocation, at: revocation.at.toString(), signature };
  }

  it("shares several accounts under one signature, and lists each of them", async () => {
    // Sharing three accounts is one decision: the reader gets one link either way, so the holder
    // should not be asked to sign once per account.
    const { chain, viewCode } = maskedChain();
    const a = app(chain);
    const stored = await post(a, "/v1/disclose", await grantFor(viewCode, { domains: ["discord.com", "x"] }));
    expect(stored.status).toBe(200);
    expect((await stored.json()).domains).toEqual(["discord.com", "x"]);

    // One signature is one permission: it lists as one row naming both accounts, not as two.
    const listed = await (await a.request(`/v1/disclosures/${aliceName}`)).json();
    expect(listed.grants).toHaveLength(1);
    expect(listed.grants[0].domains).toEqual(["discord.com", "x"]);
    // Each account is reachable on its own: the reader asks about one, not about the selection.
    expect((await a.request(`/v1/disclose/${aliceName}/x`)).status).toBe(200);
  });

  it("shares one account with two people without either share replacing the other", async () => {
    // Two grants can name the same account. Keyed by account, the second would have overwritten the
    // first, and the first reader would have lost access without anyone revoking anything.
    const { chain, viewCode } = maskedChain();
    const a = app(chain);
    const bob = registrar.address;
    const carol = user.account.address;
    await post(a, "/v1/disclose", await grantFor(viewCode, { audience: bob }));
    await post(a, "/v1/disclose", await grantFor(viewCode, { audience: carol }));

    const listed = await (await a.request(`/v1/disclosures/${aliceName}`)).json();
    expect(listed.grants).toHaveLength(2);
    expect((await a.request(`/v1/disclose/${aliceName}/x?reader=${bob}`)).status).toBe(200);
    expect((await a.request(`/v1/disclose/${aliceName}/x?reader=${carol}`)).status).toBe(200);

    // Taking one back leaves the other standing: they were always separate permissions.
    const first = listed.grants.find((g: { audience: string }) => g.audience === bob);
    expect((await post(a, "/v1/revoke", await revokeFor({ grantId: first.id }))).status).toBe(200);
    expect((await a.request(`/v1/disclose/${aliceName}/x?reader=${bob}`)).status).toBe(403);
    expect((await a.request(`/v1/disclose/${aliceName}/x?reader=${carol}`)).status).toBe(200);
  });

  it("takes back the whole grant, because that is what was handed over", async () => {
    // One link opened both accounts, so stopping that share stops both. Revoking half of a link the
    // reader already holds would be a permission nobody granted.
    const { chain, viewCode } = maskedChain();
    const a = app(chain);
    const wire = await grantFor(viewCode, { domains: ["discord.com", "x"] });
    const { id } = await (await post(a, "/v1/disclose", wire)).json();

    expect((await post(a, "/v1/revoke", await revokeFor({ grantId: id }))).status).toBe(200);
    expect((await a.request(`/v1/disclose/${aliceName}/x`)).status).toBe(404);
    expect((await a.request(`/v1/disclose/${aliceName}/discord.com`)).status).toBe(404);
    expect((await (await a.request(`/v1/disclosures/${aliceName}`)).json()).grants).toEqual([]);
  });

  it("opens for whoever holds a name in the branch, and never on the reader's say-so", async () => {
    // "Whoever at acme.com" is a group the holder cannot enumerate. The reader names a name they hold;
    // this service resolves it on chain and refuses if it does not answer with their wallet.
    const reader = registrar.address;
    // Everyone in the `x` branch, which is a group alice cannot enumerate and never has to.
    const inBranch = "bob.x.kju-is.eth";
    const outsideBranch = "bob.kju-is.eth";
    const { chain, viewCode } = maskedChain({ [inBranch]: reader, [outsideBranch]: reader });
    const a = app(chain);
    await post(a, "/v1/disclose", await grantFor(viewCode, { audienceName: "*.x.kju-is.eth" }));
    const opened = await a.request(`/v1/disclose/${aliceName}/x?reader=${reader}&as=${inBranch}`);
    expect(opened.status).toBe(200);
    expect((await opened.json()).disclosed.handle).toBe("alice_x");

    // Claiming a name is not holding it: the wallet the name resolves to has to be the caller's.
    const impostor = await a.request(
      `/v1/disclose/${aliceName}/x?reader=${user.account.address}&as=${inBranch}`
    );
    expect(impostor.status).toBe(403);
    // And a name outside the branch is refused even when the caller really does hold it.
    const outside = await a.request(`/v1/disclose/${aliceName}/x?reader=${reader}&as=${outsideBranch}`);
    expect(outside.status).toBe(403);
    // A reader who names nothing gets nothing, whatever their wallet.
    expect((await a.request(`/v1/disclose/${aliceName}/x?reader=${reader}`)).status).toBe(403);
  });

  it("says on /healthz whether a share would survive a restart", async () => {
    // Without DATA_DIR the grants live in memory only, so a redeploy silently drops every permission
    // the holder made. That is worth saying out loud rather than discovering after the fact.
    const { chain } = maskedChain();
    const memory = await (await app(chain).request("/healthz")).json();
    expect(memory.config.storage).toEqual({
      dataDir: null,
      durable: false,
      writable: false,
      lastError: null,
    });

    const dir = mkdtempSync(join(tmpdir(), "ketsuban-durable-"));
    const onDisk = createApp({ config: loadConfig({ ...baseEnv, DATA_DIR: dir }), chain, now: () => NOW });
    expect((await (await onDisk.request("/healthz")).json()).config.storage).toEqual({
      dataDir: dir,
      durable: true,
      writable: true,
      lastError: null,
    });
  });

  it("warns in preflight when a share would not survive a restart, where the app will show it", async () => {
    const { chain } = maskedChain();
    const p = await (await app(chain).request("/v1/preflight")).json();
    expect(p.warnings.join(" ")).toMatch(/DATA_DIR/);
  });

  it("reports a store it cannot write to, rather than losing shares quietly at the next restart", async () => {
    // DATA_DIR pointing somewhere with no volume behind it: writes fail, everything looks fine until
    // the service restarts, and every permission anyone granted is gone.
    const file = join(mkdtempSync(join(tmpdir(), "ketsuban-unwritable-")), "a-file");
    writeFileSync(file, "not a directory");
    const { chain, viewCode } = maskedChain();
    const a = createApp({
      config: loadConfig({ ...baseEnv, DATA_DIR: join(file, "nope") }),
      chain,
      now: () => NOW,
    });

    await post(a, "/v1/disclose", await grantFor(viewCode));
    const storage = (await (await a.request("/healthz")).json()).config.storage;
    expect(storage.writable).toBe(false);
    expect(storage.lastError).toMatch(/ENOTDIR|ENOENT|EACCES/);
  });

  it("drops a stored grant it cannot read, rather than losing the whole list to it", async () => {
    // A grant written by an older build has no `domains`. Reviving it anyway put an unusable entry in
    // the list, and every share the holder could see went with it.
    const dir = mkdtempSync(join(tmpdir(), "ketsuban-stale-"));
    const { chain, viewCode } = maskedChain();
    const boot = () =>
      createApp({ config: loadConfig({ ...baseEnv, DATA_DIR: dir }), chain, now: () => NOW });
    const { id } = await (await post(boot(), "/v1/disclose", await grantFor(viewCode))).json();

    const file = join(dir, "disclosures.json");
    const saved = JSON.parse(readFileSync(file, "utf8"));
    saved[`${aliceName}:legacy`] = {
      name: aliceName,
      domain: "x",
      audience: zeroAddress,
      exp: String(NOW + 3600),
      boxHash: `0x${"aa".repeat(32)}`,
      box: { ephemeralPubkey: "0x00", nonce: "0x00", ciphertext: "0x00" },
      signature: "0x01",
    };
    writeFileSync(file, JSON.stringify(saved));

    const after = boot();
    const listed = await (await after.request(`/v1/disclosures/${aliceName}`)).json();
    expect(listed.grants).toHaveLength(1);
    expect(listed.grants[0].id).toBe(id);
    // And the account it covers still opens: one unreadable row must not break the read either.
    expect((await after.request(`/v1/disclose/${aliceName}/x`)).status).toBe(200);
  });

  it("lists what a name has shared, so the holder can see who can read it", async () => {
    const { chain, viewCode } = maskedChain();
    const a = app(chain);

    // Nothing shared yet is an answer, not an error: the dashboard renders an empty list.
    const none = await (await a.request(`/v1/disclosures/${aliceName}`)).json();
    expect(none).toEqual({ name: aliceName, grants: [] });

    await post(a, "/v1/disclose", await grantFor(viewCode, { audience: registrar.address }));
    const listed = await (await a.request(`/v1/disclosures/${aliceName}`)).json();
    expect(listed.grants).toHaveLength(1);
    expect(listed.grants[0]).toMatchObject({
      domains: ["x"],
      audience: registrar.address,
      audienceName: "",
      expiresAt: new Date((NOW + 3600) * 1000).toISOString(),
    });
    // The listing must never carry the ciphertext or the signature: it is a summary, not the grant.
    expect(JSON.stringify(listed)).not.toContain("ciphertext");
    expect(JSON.stringify(listed)).not.toContain("signature");
  });

  it("drops a grant that has expired from the listing rather than showing dead permissions", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ketsuban-revoke-"));
    const { chain, viewCode } = maskedChain();
    const at = (t: number) =>
      createApp({ config: loadConfig({ ...baseEnv, DATA_DIR: dir }), chain, now: () => t });

    await post(at(NOW), "/v1/disclose", await grantFor(viewCode, { exp: BigInt(NOW + 10) }));
    expect((await (await at(NOW).request(`/v1/disclosures/${aliceName}`)).json()).grants).toHaveLength(1);

    // Same stored grant, a clock past its expiry: the permission is gone as far as anyone can tell.
    const later = at(NOW + 11);
    expect((await (await later.request(`/v1/disclosures/${aliceName}`)).json()).grants).toEqual([]);
    expect((await later.request(`/v1/disclose/${aliceName}/x`)).status).toBe(403);
  });

  it("takes a permission back when the holder signs for it, and refuses anyone else", async () => {
    const { chain, viewCode } = maskedChain();
    const a = app(chain);
    const { id } = await (await post(a, "/v1/disclose", await grantFor(viewCode))).json();
    expect((await a.request(`/v1/disclose/${aliceName}/x`)).status).toBe(200);

    // A stranger cannot close someone else's account, and the grant keeps working after they try.
    const stranger = await post(a, "/v1/revoke", await revokeFor({ grantId: id, signer: registrar }));
    expect(stranger.status).toBe(422);
    expect((await stranger.json()).error).toMatch(/holds the record/);
    expect((await a.request(`/v1/disclose/${aliceName}/x`)).status).toBe(200);

    const ok = await post(a, "/v1/revoke", await revokeFor({ grantId: id }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, name: aliceName, id, domains: ["x"] });
    // The reader gets the same answer as someone who was never given anything.
    expect((await a.request(`/v1/disclose/${aliceName}/x`)).status).toBe(404);
    expect((await (await a.request(`/v1/disclosures/${aliceName}`)).json()).grants).toEqual([]);
  });

  it("refuses a stale revocation, so an old signature cannot undo a later share", async () => {
    const { chain, viewCode } = maskedChain();
    const a = app(chain);
    const { id } = await (await post(a, "/v1/disclose", await grantFor(viewCode))).json();

    const stale = await post(a, "/v1/revoke", await revokeFor({ grantId: id, at: BigInt(NOW - 3600) }));
    expect(stale.status).toBe(422);
    expect((await stale.json()).error).toMatch(/too old/);
    expect((await a.request(`/v1/disclose/${aliceName}/x`)).status).toBe(200);
  });

  it("says so plainly when there is nothing to revoke", async () => {
    const { chain } = maskedChain();
    const gone = await post(app(chain), "/v1/revoke", await revokeFor());
    expect(gone.status).toBe(404);
  });

  it("publishes the key a candidate encrypts to", async () => {
    const { chain } = fakeChain();
    const body = await (await app(chain).request("/v1/enclave-key")).json();
    expect(body).toEqual({ address: ENCLAVE.address, publicKey: ENCLAVE.publicKey });
  });

  it("opens a masked handle for whoever the candidate allowed, and nobody else", async () => {
    const { chain, viewCode } = maskedChain();
    const a = app(chain);

    // Nothing is readable before a grant exists.
    expect((await a.request(`/v1/disclose/${aliceName}/x`)).status).toBe(404);
    // And the public card still only sees a commitment.
    const masked = await (await a.request(`/v1/verify/${aliceName}?links=x`)).json();
    expect(masked.links[0]).toMatchObject({ optedIn: true });
    expect(masked.links[0].disclosed).toBeUndefined();

    const stored = await post(a, "/v1/disclose", await grantFor(viewCode));
    expect(stored.status).toBe(200);

    const opened = await (await a.request(`/v1/disclose/${aliceName}/x`)).json();
    expect(opened.disclosed).toEqual({ handle: "alice_x", platformId: "1234567890" });
    expect(opened.warning).toBe(WARNING);
  });

  it("keeps a permission across a restart, so the link a candidate handed over still works", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ketsuban-grants-"));
    const { chain, viewCode } = maskedChain();
    const boot = () =>
      createApp({ config: loadConfig({ ...baseEnv, DATA_DIR: dir }), chain, now: () => NOW });

    expect((await post(boot(), "/v1/disclose", await grantFor(viewCode))).status).toBe(200);

    const afterRedeploy = boot();
    const opened = await afterRedeploy.request(`/v1/disclose/${aliceName}/x`);
    expect(opened.status).toBe(200);
    expect((await opened.json()).disclosed.handle).toBe("alice_x");
  });

  it("refuses a grant the record's wallet did not sign, and one that expired", async () => {
    const { chain, viewCode } = maskedChain();
    const a = app(chain);

    const forged = await grantFor(viewCode);
    const bySomeoneElse = {
      ...forged,
      signature: await signDisclosure(
        registrar,
        { ...forged, exp: BigInt(forged.exp), audience: forged.audience as Address },
        discloseDomain(31337, baseEnv.MULTIPASS as Hex)
      ),
    };
    const refused = await post(a, "/v1/disclose", bySomeoneElse);
    expect(refused.status).toBe(422);
    expect((await refused.json()).error).toContain("not signed by the wallet that holds the record");

    const expired = await post(a, "/v1/disclose", await grantFor(viewCode, { exp: BigInt(NOW - 1) }));
    expect(expired.status).toBe(422);
    expect((await expired.json()).error).toContain("expired");
  });

  it("honours a grant addressed to one reader", async () => {
    const { chain, viewCode } = maskedChain();
    const a = app(chain);
    await post(a, "/v1/disclose", await grantFor(viewCode, { audience: registrar.address }));

    const wrong = await a.request(`/v1/disclose/${aliceName}/x?reader=${user.account.address}`);
    expect(wrong.status).toBe(403);
    expect((await wrong.json()).error).toContain("addressed to a different reader");

    const right = await a.request(`/v1/disclose/${aliceName}/x?reader=${registrar.address}`);
    expect(right.status).toBe(200);
    expect((await right.json()).disclosed.handle).toBe("alice_x");
  });
});

describe("GET /v1/ens/:name", () => {
  const ensApp = (chain: ChainReader) =>
    createApp({
      config: loadConfig({ ...baseEnv, UNIVERSAL_RESOLVER: "0x4A1817d13E9cF196f471725176355C1234b63C70" }),
      chain,
      now: () => NOW,
    });

  it("reads the name the way any ENS client does, with the resolver it reached", async () => {
    const { chain } = fakeChain({
      texts: {
        "alice.kju-is.eth/ketsuban:answer": "terrible dictator",
        "alice.kju-is.eth/avatar": "ipfs://x",
      },
    });
    const res = await ensApp(chain).request("/v1/ens/Alice.kju-is.eth?keys=ketsuban:answer,avatar");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      name: "alice.kju-is.eth",
      universalResolver: "0x4A1817d13E9cF196f471725176355C1234b63C70",
      resolver: "0x178ff1589Be8Af3B19426Aa1d2Bd07cd178E215e",
      addr: user.account.address,
      texts: { "ketsuban:answer": "terrible dictator", avatar: "ipfs://x" },
      status: "active",
      warning: WARNING,
    });
    expect(chain.resolveUniversal).toHaveBeenCalledWith("alice.kju-is.eth", ["ketsuban:answer", "avatar"]);
  });

  it("defaults the keys, reports an unclaimed name as inactive and caps the key list", async () => {
    const { chain } = fakeChain({
      universal: { resolver: zeroAddress, addr: zeroAddress, texts: {} },
    });
    const body = await (await ensApp(chain).request("/v1/ens/nobody.kju-is.eth")).json();
    expect(body.status).toBe("inactive");
    expect(body.addr).toBeNull();
    expect(Object.keys(body.texts)).toEqual([
      "ketsuban:answer",
      "ketsuban:expiry",
      "ketsuban:humanity",
      "avatar",
      "description",
      "url",
    ]);
    const many = Array.from({ length: 14 }, (_, i) => `k${i}`).join(",");
    const capped = await (await ensApp(chain).request(`/v1/ens/a.b.eth?keys=${many}`)).json();
    expect(Object.keys(capped.texts)).toHaveLength(10);
  });

  it("501s without a universal resolver, 400s a bad name and 502s a resolver failure", async () => {
    const { chain } = fakeChain();
    expect((await app(chain).request("/v1/ens/alice.kju-is.eth")).status).toBe(501);
    expect((await ensApp(chain).request("/v1/ens/not-a-name")).status).toBe(400);
    const broken = fakeChain({ universal: new Error("UnreachableName(0x…)") });
    const res = await ensApp(broken.chain).request("/v1/ens/alice.kju-is.eth");
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("UnreachableName");
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

describe("GET /v1/name/:domain/:handle — reserved labels", () => {
  it("reports a platform label as taken even when no record holds it", async () => {
    const { chain } = fakeChain();
    const a = app(chain);
    const reserved = await (await a.request("/v1/name/kju-is/github")).json();
    expect(reserved).toMatchObject({ reserved: true, taken: true, live: false });

    // Free labels are unaffected, and a vouch domain is the candidate's own namespace.
    expect(await (await a.request("/v1/name/kju-is/alice")).json()).toMatchObject({
      reserved: false,
      taken: false,
    });
    expect(await (await a.request("/v1/name/~alice/github")).json()).toMatchObject({ reserved: false });
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
      reserved: false,
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

describe("GET /v1/reverse/:address", () => {
  it("answers what an address is called, from the Multipass record", async () => {
    const { chain } = fakeChain({ reverse: { [user.account.address.toLowerCase()]: "alice.kju-is.eth" } });
    const body = await (await app(chain).request(`/v1/reverse/${user.account.address}`)).json();
    expect(body.name).toBe("alice.kju-is.eth");
    expect(body.names).toEqual([
      { domain: "kju-is", name: "alice.kju-is.eth", resolver: instance.resolver, kind: "name" },
    ]);
    expect(body.note).toContain("not from a reverse registry");
    expect(chain.reverseName).toHaveBeenCalledWith(instance.resolver, user.account.address);

    const unknown = await (await app(chain).request(`/v1/reverse/${registrar.address}`)).json();
    expect(unknown.name).toBeNull();
    expect(unknown.names).toEqual([]);
    expect((await app(chain).request("/v1/reverse/nope")).status).toBe(400);
  });
});

describe("a domain nobody deployed yet", () => {
  it("mounts the namespace once the attester agrees the account belongs to it", async () => {
    // Nobody can enumerate every mail host, so the relay builds one on demand rather than telling a
    // person with an ordinary address to come back later.
    const { chain } = fakeChain({
      ready: { "example.com": { initialised: false, active: false, registrarOk: true } },
    });
    chain.ensureNamespace = vi.fn(async (domain: string) => ({
      domain,
      created: true,
      parentName: "com.example.@.kju-is.eth",
    }));
    const env2 = { ...baseEnv, NAMESPACE_FACTORY: baseEnv.FACTORY };
    const res = await app(chain, env2).request("/v1/attest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(await wireRequest({ domain: "example.com" })),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(fromBytes32(body.record.domainName)).toBe("example.com");
    // Named by the label it takes inside that namespace, not by the whole address.
    expect(fromBytes32(body.record.name)).toBe("alice");
    expect(chain.ensureNamespace).toHaveBeenCalledWith("example.com");
  });

  it("does not spend for a request the attester refuses", async () => {
    // The address belongs to example.com, so gmail.com must neither sign nor mount.
    const { chain } = fakeChain({
      ready: { "gmail.com": { initialised: false, active: false, registrarOk: true } },
    });
    chain.ensureNamespace = vi.fn(async (domain: string) => ({ domain, created: true, parentName: "x" }));
    const res = await app(chain, { ...baseEnv, NAMESPACE_FACTORY: baseEnv.FACTORY }).request("/v1/attest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(await wireRequest({ domain: "gmail.com" })),
    });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("not an account at gmail.com");
    expect(chain.ensureNamespace).not.toHaveBeenCalled();
  });

  it("says what failed when the mount does not go through, rather than handing back a dead signature", async () => {
    const { chain } = fakeChain({
      ready: { "example.com": { initialised: false, active: false, registrarOk: true } },
    });
    chain.ensureNamespace = vi.fn(async () => {
      throw new Error("relayer out of gas");
    });
    const res = await app(chain, { ...baseEnv, NAMESPACE_FACTORY: baseEnv.FACTORY }).request("/v1/attest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(await wireRequest({ domain: "example.com" })),
    });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain("could not mount");
  });

  it("still refuses a domain no account could belong to", async () => {
    const { chain } = fakeChain({
      ready: { myspace: { initialised: false, active: false, registrarOk: true } },
    });
    const res = await app(chain).request("/v1/attest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(await wireRequest({ domain: "myspace" })),
    });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain("not initialised");
  });
});

describe("a name in the private branch", () => {
  it("is answered by the mirror, which knows only that the person has an account there", async () => {
    // `alice.com.x.private-www.<root>` is the person's name in the private branch: it resolves to her
    // wallet and her own records, and says nothing about which account she holds.
    const { chain } = fakeChain({
      instances: [instance, xComInstance],
      addr: user.account.address,
      texts: { "ketsuban:answer": "terrible dictator" },
    });
    const name = `alice.${xComInstance.maskedParentName}`;
    const body = await (await app(chain).request(`/v1/verify/${name}`)).json();
    expect(body.status).toBe("active");
    expect(body.branch).toBe("private");
    expect(body.wallet).toBe(user.account.address);
    expect(body.answer).toBe("terrible dictator");
    // Read through the mirror's resolver, not the platform's open one.
    expect(chain.resolveAddr).toHaveBeenCalledWith(xComInstance.maskedResolver, name);
  });

  it("is not answered where the deployment has no private branch", async () => {
    const { chain } = fakeChain({ instances: [instance, xInstance], addr: user.account.address });
    const res = await app(chain).request("/v1/verify/alice.com.x.private-www.kju-is.eth");
    expect(res.status).toBe(404);
  });
});

describe("a domain the chain already has", () => {
  it("is attested without mounting anything, even where the deployment cannot mount", async () => {
    // `discord.com` is live on Multipass. A deployment missing one address for mounting must not turn
    // that into a refusal: the record is writable exactly as it is.
    const { chain } = fakeChain({ instances: [instance, xInstance] });
    chain.ensureNamespace = vi.fn(async () => {
      throw new Error("a namespace needs NAMESPACE_FACTORY, REGISTRY, PERMISSIONED_RESOLVER");
    });
    const res = await app(chain, { ...baseEnv, NAMESPACE_FACTORY: baseEnv.FACTORY }).request("/v1/attest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(await wireRequest({ domain: "example.com" })),
    });
    expect(res.status).toBe(200);
    expect(chain.ensureNamespace).not.toHaveBeenCalled();
  });
});

describe("what a verifier is shown without asking", () => {
  it("looks for the accounts this deployment mounts, so nobody has to guess a domain list", async () => {
    const { chain } = fakeChain({ instances: [instance, xComInstance], addr: user.account.address });
    await app(chain).request(`/v1/verify/alice.${instance.parentName}`);
    const asked = (chain.resolveData as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[2]);
    expect(asked).toContain("ketsuban:link:x.com");
    // The flat names stay in the list: records written before the namespace existed still count.
    expect(asked).toContain("ketsuban:link:x");
    // A name domain, the org and a vouch instance are not accounts and are never asked for.
    expect(asked).not.toContain("ketsuban:link:kju-is");
  });

  it("names the evidence after the platform, not after the mount", async () => {
    const { chain } = fakeChain({
      instances: [instance, xComInstance],
      addr: user.account.address,
      data: {
        "ketsuban:link:x.com": `0x${toBytes32("alice_x").slice(2)}${toBytes32("1").slice(2)}${zeroHash.slice(2)}`,
      },
    });
    const body = await (await app(chain).request(`/v1/verify/alice.${instance.parentName}`)).json();
    expect(body.branch).toBe("open");
    expect(body.evidence).toContain("x_account_control");
    // A name the verifier can check for themselves, in any ENS client.
    expect(body.links).toContainEqual({
      domain: "x.com",
      optedIn: false,
      ensName: "alice_x.com.x.www.kju-is.eth",
    });
  });

  it("names a masked account after the person, so even a private link is checkable", async () => {
    const masked = `0x${toBytes32("x").slice(2)}${toBytes32("1").slice(2)}${toBytes32("commit").slice(2)}`;
    const { chain } = fakeChain({
      instances: [instance, xComInstance],
      addr: user.account.address,
      data: { "ketsuban:link:x.com": masked },
    });
    const body = await (await app(chain).request(`/v1/verify/alice.${instance.parentName}`)).json();
    expect(body.links[0]).toMatchObject({
      domain: "x.com",
      optedIn: true,
      ensName: "alice.com.x.private-www.kju-is.eth",
    });
    // The account's own name is never published: only the person's.
    expect(body.links[0].disclosed).toBeUndefined();
  });
});

describe("GET /v1/eth-label/:label", () => {
  it("says who owns the label on the registry the bridge checks", async () => {
    // `linkOwnName` reverts with NotNameOwner for anyone else, and a name held on another ENS
    // deployment is simply not here. Both answers are worth having before a wallet signs.
    const { chain } = fakeChain();
    chain.ethLabelOwner = vi.fn(async (label: string) =>
      label === "alice" ? user.account.address : zeroAddress
    );
    const app2 = app(chain, { ...baseEnv, ETH_REGISTRY: baseEnv.BRIDGE });

    const mine = await (await app2.request("/v1/eth-label/alice")).json();
    expect(mine).toEqual({ label: "alice", registry: baseEnv.BRIDGE, owner: user.account.address });

    const nobody = await (await app2.request("/v1/eth-label/test-account-123456")).json();
    expect(nobody.owner).toBeNull();

    expect((await app2.request("/v1/eth-label/not a label")).status).toBe(400);
  });

  it("says so when no registry is configured, instead of pretending nobody owns it", async () => {
    const { chain } = fakeChain();
    const res = await app(chain).request("/v1/eth-label/alice");
    expect(res.status).toBe(501);
  });
});

describe("GET /v1/reverse: what ENS itself says", () => {
  it("reports the holder's own primary name, and that nobody here writes it", async () => {
    // A wallet's primary name is set by its holder in ENS's reverse namespace. This deployment answers
    // reverse lookups from the record regardless, so the two are worth telling apart.
    const { chain } = fakeChain({
      reverse: { [user.account.address.toLowerCase()]: "alice.kju-is.eth" },
      primary: "alice.eth",
    });
    const body = await (await app(chain).request(`/v1/reverse/${user.account.address}`)).json();
    expect(body.primary).toBe("alice.eth");
    expect(body.name).toBe("alice.kju-is.eth");

    const unset = fakeChain({ reverse: { [user.account.address.toLowerCase()]: "alice.kju-is.eth" } });
    const without = await (await app(unset.chain).request(`/v1/reverse/${user.account.address}`)).json();
    expect(without.primary).toBeNull();
    expect(without.name).toBe("alice.kju-is.eth");
  });
});

describe("GET /v1/reverse: the accounts are names too", () => {
  it("lists what a wallet answers to, its own name and every account it attested", async () => {
    // The dashboard and reverse resolution must agree: same records, same names, one rule.
    const record = (domain: string, name: string, payload: string) => ({
      domain,
      name,
      id: toBytes32(name),
      wallet: user.account.address,
      payload: toBytes32(payload),
      validUntil: 1_800_000_000n,
      nonce: 1n,
      live: true,
    });
    const { chain } = fakeChain({
      instances: [instance, xComInstance],
      reverse: { [user.account.address.toLowerCase()]: "alice.kju-is.eth" },
      byWallet: [
        record("kju-is", "alice", "hi"),
        record("x.com", "alice_x", ""),
        record("x.com", "\u009f\u00c2", "commitment"),
      ],
    });
    const body = await (await app(chain).request(`/v1/reverse/${user.account.address}`)).json();
    expect(body.name).toBe("alice.kju-is.eth");
    expect(body.names.map((n: { name: string; kind: string }) => [n.kind, n.name])).toEqual([
      ["name", "alice.kju-is.eth"],
      ["account", "alice_x.com.x.www.kju-is.eth"],
      // The masked one is named after the person, and answered by the mirror.
      ["private", "alice.com.x.private-www.kju-is.eth"],
    ]);
    expect(body.names[2].resolver).toBe(xComInstance.maskedResolver);
  });
});

describe("GET /v1/wallet/:address", () => {
  it("names a masked account after the person who holds it", async () => {
    // The account's own name is a one-time pad over the handle, so the private branch names the person:
    // the row says an account exists on X and never which one.
    const masked = {
      domain: "x.com",
      name: "\u009f\u00c2\u00ab",
      id: toBytes32("masked"),
      wallet: user.account.address,
      payload: toBytes32("commitment"),
      validUntil: 1_800_000_000n,
      nonce: 1n,
      live: true,
    };
    const held = {
      ...masked,
      domain: "kju-is",
      name: "alice",
      id: toBytes32("alice"),
      payload: toBytes32("hi"),
    };
    const { chain } = fakeChain({
      instances: [instance, xComInstance],
      byWallet: [held, masked],
    });
    const body = await (await app(chain).request(`/v1/wallet/${user.account.address}`)).json();
    expect(body.links).toHaveLength(1);
    expect(body.links[0]).toMatchObject({
      domain: "x.com",
      optedIn: true,
      ensName: "alice.com.x.private-www.kju-is.eth",
      nameless: null,
    });
  });

  it("says a masked account is private when nothing names it", async () => {
    // No private branch deployed, or no name held: the row must not invent one.
    const { chain } = fakeChain({
      instances: [instance, xInstance],
      byWallet: [
        {
          domain: "x",
          name: "\u009f",
          id: toBytes32("masked"),
          wallet: user.account.address,
          payload: toBytes32("commitment"),
          validUntil: 1_800_000_000n,
          nonce: 1n,
          live: true,
        },
      ],
    });
    const body = await (await app(chain).request(`/v1/wallet/${user.account.address}`)).json();
    expect(body.links[0]).toMatchObject({ ensName: null, nameless: "private" });
  });

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
        // The platform is mounted, so the account has a name to be read by.
        ensName: "alice_x.x.kju-is.eth",
        nameless: null,
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
    expect(body.org).toBeNull();
    expect(body.balance).toBe("0");
    expect(body.gasTopup).toEqual({ enabled: false, amount: "0", available: false });
    expect((await app(chain).request("/v1/wallet/nope")).status).toBe(400);
  });

  it("names a public account and leaves a masked one unnamed", async () => {
    const link = (name: string, payload: Hex) => ({
      domain: "x",
      name,
      id: toBytes32(name),
      wallet: user.account.address,
      payload,
      validUntil: 1_800_000_000n,
      nonce: 1n,
      live: true,
    });
    // The platform domain has its own instance, so a public handle is a name under it.
    const withInstance = { ...instance, domain: "x", parentName: "x.kju-is.eth", parentLabel: "x" };
    const open = fakeChain({ instances: [instance, withInstance], byWallet: [link("alice_x", zeroHash)] });
    const body = await (await app(open.chain).request(`/v1/wallet/${user.account.address}`)).json();
    expect(body.links[0]).toMatchObject({
      domain: "x",
      optedIn: false,
      ensName: "alice_x.x.kju-is.eth",
      nameless: null,
    });
    // It is a linked account, not a name: only configured name domains carry a handle and an answer.
    expect(body.names).toEqual([]);

    const masked = fakeChain({
      instances: [instance, withInstance],
      byWallet: [link("0xdeadbeef", toBytes32("commitment"))],
    });
    const hidden = await (await app(masked.chain).request(`/v1/wallet/${user.account.address}`)).json();
    expect(hidden.links[0]).toMatchObject({ optedIn: true, ensName: null });
  });

  it("never renders a masked record's bytes as text", async () => {
    const viewCode = `0x${"5a".repeat(32)}` as Hex;
    const { chain } = fakeChain({
      byWallet: [
        {
          domain: "google",
          // The index decodes bytes32 to text before this route sees it, mojibake and all.
          name: fromBytes32(maskName("tim@peeramid.xyz", viewCode)),
          id: maskId("1234", viewCode),
          wallet: user.account.address,
          payload: viewCodeCommitment(viewCode),
          validUntil: 1_800_000_000n,
          nonce: 2n,
          live: true,
        },
      ],
    });
    const body = await (await app(chain).request(`/v1/wallet/${user.account.address}`)).json();
    // Mojibake reads like corruption; empty reads like privacy, which is what this is.
    expect(body.links[0]).toMatchObject({
      domain: "google",
      name: "",
      payload: "",
      optedIn: true,
      ensName: null,
      nameless: "private",
    });
  });

  it("says why a public account still has no name when its handle cannot be a label", async () => {
    const link = (name: string) => ({
      domain: "google",
      name,
      id: toBytes32("id"),
      wallet: user.account.address,
      payload: zeroHash,
      validUntil: 1_800_000_000n,
      nonce: 1n,
      live: true,
    });
    const withInstance = {
      ...instance,
      domain: "google",
      parentName: "google.kju-is.eth",
      parentLabel: "google",
    };
    // An email address is not an ENS label: `@` and `.` separate labels, they are not characters in one.
    const email = fakeChain({ instances: [instance, withInstance], byWallet: [link("tim@peeramid.xyz")] });
    const body = await (await app(email.chain).request(`/v1/wallet/${user.account.address}`)).json();
    expect(body.links[0]).toMatchObject({ ensName: null, nameless: "not-a-label" });

    const handle = fakeChain({ instances: [instance, withInstance], byWallet: [link("peersky")] });
    const named = await (await app(handle.chain).request(`/v1/wallet/${user.account.address}`)).json();
    expect(named.links[0]).toMatchObject({ ensName: "peersky.google.kju-is.eth", nameless: null });
  });

  it("shows a name the index has not caught up to yet, read straight from the chain", async () => {
    // The exact shape of the live failure: reverse resolution finds the name, the index is still
    // backfilling and lists nothing.
    const onChainOnly = {
      domain: "kju-is",
      name: "peersky",
      id: toBytes32("peersky"),
      wallet: user.account.address,
      payload: zeroHash,
      validUntil: 1_800_000_000n,
      nonce: 1n,
      live: true,
    };
    const { chain } = fakeChain();
    chain.listRecordsByWallet = vi.fn(async () => []);
    chain.recordFor = vi.fn(async (_w: Address, domain: string) =>
      domain === "kju-is" ? onChainOnly : undefined
    );
    const body = await (await app(chain).request(`/v1/wallet/${user.account.address}`)).json();
    expect(body.names).toEqual([
      {
        domain: "kju-is",
        name: "peersky",
        payload: "",
        validUntil: "2027-01-15T08:00:00.000Z",
        nonce: "1",
        live: true,
        ensName: "peersky.kju-is.eth",
      },
    ]);
  });

  it("does not list the same record twice when the index has caught up", async () => {
    const both = {
      domain: "kju-is",
      name: "peersky",
      id: toBytes32("peersky"),
      wallet: user.account.address,
      payload: zeroHash,
      validUntil: 1_800_000_000n,
      nonce: 1n,
      live: true,
    };
    const { chain } = fakeChain({ byWallet: [both] });
    const body = await (await app(chain).request(`/v1/wallet/${user.account.address}`)).json();
    expect(body.names).toHaveLength(1);
  });

  it("reports an organisation, and keeps it out of the linked accounts", async () => {
    const org = {
      domain: "org",
      name: "acme-university",
      id: toBytes32("acme"),
      wallet: user.account.address,
      payload: zeroHash,
      validUntil: 1_800_000_000n,
      nonce: 1n,
      live: true,
    };
    const { chain } = fakeChain({ byWallet: [org] });
    const body = await (await app(chain).request(`/v1/wallet/${user.account.address}`)).json();
    expect(body.org).toEqual({ label: "acme-university", validUntil: "2027-01-15T08:00:00.000Z" });
    expect(body.links).toEqual([]);
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

  it("remembers a top-up across a restart, so once per wallet means once", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ketsuban-gas-"));
    const { chain, state } = fakeChain({ byWallet: [live], balance: 0n });
    const boot = () =>
      createApp({
        config: loadConfig({ ...baseEnv, GAS_TOPUP_WEI: "2000000000000000", DATA_DIR: dir }),
        chain,
        now: () => NOW,
      });
    expect((await post(boot(), "/v1/gas", body)).status).toBe(200);
    expect(state.sent).toHaveLength(1);

    // A redeploy used to hand the same wallet another payout.
    const again = await post(boot(), "/v1/gas", body);
    expect(again.status).toBe(409);
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

describe("a deployment this build already knows", () => {
  it("fills the addresses an operator did not set, without overriding the ones they did", async () => {
    // Half of every deployment problem has been one address missing from an environment. The chain id
    // is enough to know them: this build ships the deployment it was built against.
    const { loadConfig } = await import("../../src/config.js");
    const minimal = loadConfig({
      RPC_URL: "https://rpc.example",
      CHAIN_ID: "11155111",
      RELAYER_KEY: baseEnv.RELAYER_KEY,
      PRIVY_APP_ID: baseEnv.PRIVY_APP_ID,
      PRIVY_VERIFICATION_KEY_JWK: baseEnv.PRIVY_VERIFICATION_KEY_JWK,
      NAME_DOMAINS: "ketsuban",
    });
    expect(minimal.MULTIPASS).toBe("0x418F82fd0014a4CA402F145978bfaF0555a9cA06");
    expect(minimal.PERMISSIONED_RESOLVER).toBe("0x4E2d9783cEFF2ed72CD77C14206b29fe246b24F7");
    expect(minimal.NAMESPACE_FACTORY).toBeTruthy();
    expect(minimal.ETH_REGISTRAR).toBeTruthy();

    // What the operator sets still wins: a fork or a fresh deployment is theirs to name.
    const overridden = loadConfig({
      RPC_URL: "https://rpc.example",
      CHAIN_ID: "11155111",
      MULTIPASS: baseEnv.MULTIPASS,
      RELAYER_KEY: baseEnv.RELAYER_KEY,
      PRIVY_APP_ID: baseEnv.PRIVY_APP_ID,
      PRIVY_VERIFICATION_KEY_JWK: baseEnv.PRIVY_VERIFICATION_KEY_JWK,
      NAME_DOMAINS: "ketsuban",
    });
    expect(overridden.MULTIPASS).toBe(baseEnv.MULTIPASS);
  });

  it("says what is missing on a chain it ships nothing for", () => {
    expect(() =>
      loadConfig({ RPC_URL: "https://rpc.example", CHAIN_ID: "999999", RELAYER_KEY: baseEnv.RELAYER_KEY })
    ).toThrow();
  });
});

describe("GET /v1/explain/:name", () => {
  it("says what a name would claim, by the same rule the app shows", async () => {
    const { chain } = fakeChain({ instances: [instance, xComInstance] });
    const ask = async (name: string) => (await app(chain).request(`/v1/explain/${name}`)).json();

    expect(await ask("alice_x.com.x.www.kju-is.eth")).toMatchObject({
      kind: "account",
      domain: "x.com",
      label: "alice_x",
    });
    expect(await ask("alice.com.x.private-www.kju-is.eth")).toMatchObject({ kind: "private" });
    expect(await ask("alice.kju-is.eth")).toMatchObject({ kind: "person" });
    expect(await ask("bob.alice.kju-is.eth")).toMatchObject({ kind: "reference" });
    // An agent must be able to tell this from a name nobody happens to hold.
    expect(await ask("alice.example.com")).toMatchObject({ kind: "unknown" });
  });
});

describe("an empty setting means what it says", () => {
  it("keeps nothing on disk when DATA_DIR is empty, rather than falling back to the container's path", () => {
    // The merge with a known deployment used to drop every empty value, which silently turned "keep
    // nothing" into "/data" — a path a test or a local run cannot write.
    expect(loadConfig({ ...baseEnv, DATA_DIR: "" }).DATA_DIR).toBe("");
    expect(loadConfig({ ...baseEnv, DATA_DIR: "/tmp/x" }).DATA_DIR).toBe("/tmp/x");
    // An address is different: an empty value never blanks one the deployment supplied.
    const filled = loadConfig({ ...baseEnv, CHAIN_ID: "11155111", MULTIPASS: "" });
    expect(filled.MULTIPASS).toBe("0x418F82fd0014a4CA402F145978bfaF0555a9cA06");
  });
});

describe("the avatar a profile points at", () => {
  const png = () => {
    // A one-pixel PNG: the magic number is what the service trusts, never the name or the header.
    const bytes = Buffer.from(
      "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082",
      "hex"
    );
    return new File([bytes], "me.png", { type: "image/png" });
  };
  const upload = (app: ReturnType<typeof createApp>, file: File) => {
    const body = new FormData();
    body.set("file", file);
    return app.request("/v1/avatar", { method: "POST", body });
  };

  it("keeps a picture and serves it back at the URL a text record can hold", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ketsuban-avatar-"));
    const { chain } = fakeChain();
    const a = createApp({ config: loadConfig({ ...baseEnv, DATA_DIR: dir }), chain, now: () => NOW });

    const stored = await upload(a, png());
    expect(stored.status).toBe(200);
    const { url } = await stored.json();
    // An absolute URL, because the record is read by ENS clients that never saw this app.
    expect(url).toMatch(/^https?:\/\/.+\/v1\/avatar\/[0-9a-f]{64}\.png$/);

    const served = await a.request(new URL(url).pathname);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    // A picture is not a document: it must never be sniffed into one.
    expect(served.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await served.arrayBuffer()).length).toBeGreaterThan(60);
  });

  it("names a picture by its own bytes, so the same one is stored once", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ketsuban-avatar-dedupe-"));
    const { chain } = fakeChain();
    const a = createApp({ config: loadConfig({ ...baseEnv, DATA_DIR: dir }), chain, now: () => NOW });
    const one = await (await upload(a, png())).json();
    const two = await (await upload(a, png())).json();
    expect(one.url).toBe(two.url);
  });

  it("refuses anything that is not a picture, whatever it calls itself", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ketsuban-avatar-bad-"));
    const { chain } = fakeChain();
    const a = createApp({ config: loadConfig({ ...baseEnv, DATA_DIR: dir }), chain, now: () => NOW });

    // An HTML page announcing itself as a PNG is the upload that matters: served back under a name a
    // browser trusts, it would run as a page on this origin.
    const html = new File([Buffer.from("<script>alert(1)</script>")], "me.png", { type: "image/png" });
    const refused = await upload(a, html);
    expect(refused.status).toBe(415);
    expect((await refused.json()).error).toMatch(/picture/i);
  });

  it("refuses a picture too large to be an avatar", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ketsuban-avatar-big-"));
    const { chain } = fakeChain();
    const a = createApp({ config: loadConfig({ ...baseEnv, DATA_DIR: dir }), chain, now: () => NOW });
    const huge = new File([Buffer.alloc(2_000_001, 1)], "me.png", { type: "image/png" });
    expect((await upload(a, huge)).status).toBe(413);
  });

  it("says the picture could not be kept, rather than failing with no reason at all", async () => {
    // DATA_DIR set to a path with no volume behind it: the directory cannot be made, and an unhandled
    // throw here is a 500 with nothing in it for whoever has to fix the deployment.
    const file = join(mkdtempSync(join(tmpdir(), "ketsuban-avatar-ro-")), "a-file");
    writeFileSync(file, "not a directory");
    const { chain } = fakeChain();
    const a = createApp({
      config: loadConfig({ ...baseEnv, DATA_DIR: join(file, "nope") }),
      chain,
      now: () => NOW,
    });
    const refused = await upload(a, png());
    expect(refused.status).toBe(503);
    expect((await refused.json()).error).toMatch(/DATA_DIR/);
  });

  it("says so plainly when there is nowhere to keep it", async () => {
    // Without DATA_DIR the picture would vanish on the next restart and the record would dangle.
    const { chain } = fakeChain();
    const a = createApp({ config: loadConfig({ ...baseEnv, DATA_DIR: "" }), chain, now: () => NOW });
    const refused = await upload(a, png());
    expect(refused.status).toBe(501);
    expect((await refused.json()).error).toMatch(/DATA_DIR/);
  });
});
