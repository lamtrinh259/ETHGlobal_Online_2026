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
import type { ChainReader, Instance } from "../../src/chain.js";
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
};

function fakeChain(state: Partial<State> = {}) {
  const s: State = { records: {}, texts: {}, addr: zeroAddress, data: {}, ...state };
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

describe("GET /healthz", () => {
  it("reports relayer and chain", async () => {
    const { chain } = fakeChain();
    const res = await app(chain).request("/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, relayer: chain.relayer, chainId: 31337 });
  });
});

describe("POST /v1/attest (node registrar fallback)", () => {
  it("signs a record identical in shape to the enclave output", async () => {
    const { chain } = fakeChain();
    const res = await post(app(chain), "/v1/attest", await wireRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.record).toEqual({
      name: toBytes32("fatpig"),
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
      handle: "fatpig",
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
      name: toBytes32("fatpig"),
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
      evidence: ["wallet_binding"],
      decision: "no_record",
      warning: WARNING,
    });
  });

  it("assembles an active record from resolver reads, including opted-in links", async () => {
    const viewCode = keccak256("0x01");
    const masked = {
      name: maskName("fatpig_x", viewCode),
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
          [toBytes32("fatpig_tg"), toBytes32("987"), zeroHash]
        ),
      },
    });
    const body = await (
      await app(chain).request(`/v1/verify/fatpig.kju-is.eth?links=x,telegram&viewCode=${viewCode}`)
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
        disclosed: { handle: "fatpig_x", platformId: "42" },
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
    expect(chain.resolveData).toHaveBeenCalledWith(instance.resolver, "fatpig.kju-is.eth", "ketsuban:link:x");
  });

  it("keeps opted-in links masked without a matching view code", async () => {
    const viewCode = keccak256("0x02");
    const masked = encodePacked(
      ["bytes32", "bytes32", "bytes32"],
      [maskName("h", viewCode), maskId("1", viewCode), viewCodeCommitment(viewCode)]
    );
    const { chain } = fakeChain({ addr: user.account.address, data: { "ketsuban:link:x": masked } });
    const body = await (
      await app(chain).request(`/v1/verify/fatpig.kju-is.eth?links=x&viewCode=${keccak256("0x03")}`)
    ).json();
    expect(body.links).toEqual([{ domain: "x", optedIn: true, commitment: viewCodeCommitment(viewCode) }]);
  });
});

describe("locate", () => {
  it("matches the longest known parent and rejects nested labels", () => {
    expect(locate("fatpig.kju-is.eth", [instance])).toEqual({ handle: "fatpig", instance });
    expect(locate("a.b.kju-is.eth", [instance])).toBeUndefined();
    expect(locate("kju-is.eth", [instance])).toBeUndefined();
    expect(locate("x.other.eth", [instance])).toBeUndefined();
  });
});
