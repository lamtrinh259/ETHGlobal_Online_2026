import { describe, expect, test } from "bun:test";
import type { TeeRuntime } from "@chainlink/cre-sdk";
import { baseIntent, fakePrivy, fakeUser, signedAttestRequest, toWire } from "@ketsuban/registrar/testing";
import {
  decodeRecord,
  maskId,
  maskName,
  MultipassAbi,
  registerNameTypes,
  toBytes32,
  viewCodeCommitment,
} from "@peeramid-labs/multipass-client";
import {
  bytesToHex,
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionResult,
  parseAbiParameters,
  recoverTypedDataAddress,
  bytesToString,
  hexToBytes,
  stringToBytes,
  zeroHash,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { discloseDomain, eciesDecrypt, eciesEncrypt, hashBox, signDisclosure } from "@ketsuban/registrar";
import {
  encodeReport,
  handleFromLog,
  onDisclose,
  initWorkflow,
  onAttest,
  onRegistered,
  parseRequest,
  serializeResult,
  type Config,
} from "./workflow";

const NOW = 1_800_000_000;
const REGISTRAR_KEY = "0x000000000000000000000000000000000000000000000000000000000000b0b0" as const;
const VIEWCODE_KEY = "0x1111111111111111111111111111111111111111111111111111111111111111" as const;
const USER_KEY = "0x000000000000000000000000000000000000000000000000000000000000a11c" as const;
const privy = fakePrivy("cltest-app-id");
const user = fakeUser(USER_KEY);
const registrar = privateKeyToAccount(REGISTRAR_KEY);
/** keccak256("Registered(bytes32,(address,bytes32,bytes32,uint96,bytes32,uint256,bytes32))") */
const REGISTERED_TOPIC = "0x2fb8df3bcbdf51d34b8e8576c995dd85a25f786cb813aef1d1b0d655b0fb5406";

const config: Config = {
  chainSelectorName: "ethereum-testnet-sepolia",
  chainId: 11155111,
  multipass: "0x418F82fd0014a4CA402F145978bfaF0555a9cA06",
  eip712: { name: "MultipassDNS", version: "1.0.0" },
  privy: { appId: privy.appId, verificationKey: privy.jwk },
  nameDomains: ["kju-is"],
  // The domains the deployment mounts, which is what makes `x.com` writable in the enclave.
  platformDomains: ["x", "x.com", "peeramid.xyz"],
  secretIds: { registrarKey: "REGISTRAR_KEY", viewcodeKey: "VIEWCODE_KEY" },
  authorizedKeys: [],
  deliveryUrl: "",
  provisionUrl: "",
  reportGasLimit: "1200000",
};

/** Capability payloads arrive as protobuf messages (bytes) or JSON (base64) depending on the SDK path */
const asBytes = (v: Uint8Array | string): Uint8Array =>
  typeof v === "string" ? Uint8Array.from(Buffer.from(v, "base64")) : v;

type OnchainFixture = { exists: boolean; nonce: bigint; id: Hex; wallet: Hex };
const emptyRecord = { wallet: "0x0000000000000000000000000000000000000000", name: zeroHash, id: zeroHash, nonce: 0n, domainName: zeroHash, validUntil: 0n, payload: zeroHash } as const;

/**
 * The public test surface ships no TEE runtime factory, so this stands up the slice the
 * handler uses: config, now, getSecret, and a DON runtime whose callCapability answers the
 * Multipass `resolveRecord` read and the optional delivery POST.
 */
function fakeTeeRuntime(
  opts: { onchain?: OnchainFixture; deliveryStatus?: number; cfg?: Config; txStatus?: number } = {}
) {
  const cfg = opts.cfg ?? config;
  const evmCalls: { to: string; args: unknown }[] = [];
  const deliveries: { url: string; body: string }[] = [];
  const secretsRequested: string[] = [];
  const onchain = opts.onchain ?? { exists: false, nonce: 0n, id: zeroHash, wallet: emptyRecord.wallet };

  const reports: string[] = [];
  const writes: { receiver: string; gasLimit: string }[] = [];
  const donRuntime: any = {
    config: cfg,
    report: (req: any) => {
      // prepareReportRequest carries the payload as base64 (protobuf bytes on the wire).
      reports.push(bytesToHex(Uint8Array.from(Buffer.from(String(req.encodedPayload ?? ""), "base64"))));
      // The SDK unwraps the report handle before sending it to the capability.
      const wrapped = { x_generatedCodeOnly_unwrap: () => ({ rawReport: new Uint8Array([1, 2, 3]) }) };
      return { result: () => wrapped };
    },
    callCapability: ({ capabilityId, payload }: { capabilityId: string; payload: any }) => {
      if (capabilityId.startsWith("evm") && !payload.call) {
        writes.push({
          receiver: bytesToHex(asBytes(payload.receiver)),
          gasLimit: String(payload.gasConfig?.gasLimit ?? ""),
        });
        return {
          result: () => ({
            // TX_STATUS_SUCCESS = 2, TX_STATUS_REVERTED = 1, TX_STATUS_FATAL = 0
            txStatus: opts.txStatus ?? 2,
            txHash: Uint8Array.from(Buffer.from("dd".repeat(32), "hex")),
            errorMessage: opts.txStatus !== undefined && opts.txStatus !== 2 ? "reverted" : "",
          }),
        };
      }
      if (capabilityId.startsWith("evm")) {
        const data = bytesToHex(asBytes(payload.call.data));
        const to = bytesToHex(asBytes(payload.call.to));
        evmCalls.push({ to, args: decodeFunctionData({ abi: MultipassAbi, data }).args });
        const encoded = encodeFunctionResult({
          abi: MultipassAbi,
          functionName: "resolveRecord",
          result: [onchain.exists, { ...emptyRecord, nonce: onchain.nonce, id: onchain.id, wallet: onchain.wallet }],
        });
        return { result: () => ({ data: Uint8Array.from(Buffer.from(encoded.slice(2), "hex")) }) };
      }
      if (capabilityId.startsWith("http")) {
        const body = Buffer.from(asBytes(payload.body)).toString();
        deliveries.push({ url: payload.url, body });
        // The relay answers the provisioning endpoint and the delivery endpoint differently.
        const reply = String(payload.url).endsWith("/provision")
          ? { handle: JSON.parse(body).handle, domain: `~${JSON.parse(body).handle}`, created: true }
          : { ok: true, txHash: "0xabc" };
        return {
          result: () => ({
            statusCode: opts.deliveryStatus ?? 200,
            body: stringToBytes(JSON.stringify(reply)),
          }),
        };
      }
      throw new Error(`unexpected capability ${capabilityId}`);
    },
    runInNodeMode: (fn: any) => (...args: any[]) => ({ result: () => fn(donRuntime, ...args) }),
    now: () => new Date(NOW * 1000),
    log: () => {},
  };

  const runtime = {
    config: cfg,
    now: () => new Date(NOW * 1000),
    log: () => {},
    getSecret: ({ id }: { id: string }) => {
      secretsRequested.push(id);
      return { result: () => ({ id, value: id === "REGISTRAR_KEY" ? REGISTRAR_KEY : VIEWCODE_KEY }) };
    },
    usingTheDons: () => donRuntime,
  };
  return {
    runtime: runtime as unknown as TeeRuntime<Config>,
    evmCalls,
    deliveries,
    secretsRequested,
    reports,
    writes,
  };
}

async function request(over: Parameters<typeof baseIntent>[2] = {}, tokenOverrides: Partial<Parameters<typeof privy.mint>[0]> = {}) {
  const intent = baseIntent(user.account, NOW, over);
  const idToken = privy.mint({ sub: user.did, linked: user.linked, now: NOW, ...tokenOverrides });
  const req = await signedAttestRequest(user.account, intent, idToken, config.chainId, config.multipass as Hex);
  return { input: stringToBytes(JSON.stringify(toWire(req))) };
}

describe("onAttest", () => {
  test("reads the wallet's record on the DON, signs a public platform record in the enclave", async () => {
    const { runtime, evmCalls, deliveries, secretsRequested } = fakeTeeRuntime();
    const out = JSON.parse(await onAttest(runtime, (await request()) as any));

    expect(evmCalls).toHaveLength(1);
    expect(evmCalls[0].to.toLowerCase()).toBe(config.multipass.toLowerCase());
    expect((evmCalls[0].args as any)[0]).toMatchObject({ wallet: user.account.address, domainName: toBytes32("x") });
    expect(secretsRequested).toEqual(["REGISTRAR_KEY", "VIEWCODE_KEY"]);
    expect(deliveries).toHaveLength(0);

    expect(out.record).toEqual({
      name: toBytes32("alice"),
      id: toBytes32("1234567890123456789"),
      domainName: toBytes32("x"),
      validUntil: String(NOW + 30 * 86400),
      nonce: "1",
      wallet: user.account.address,
      payload: zeroHash,
    });
    expect(out.viewCode).toBeNull();
    const signer = await recoverTypedDataAddress({
      domain: { ...config.eip712, chainId: config.chainId, verifyingContract: config.multipass as Hex },
      types: registerNameTypes,
      primaryType: "registerName",
      message: { ...out.record, validUntil: BigInt(out.record.validUntil), nonce: BigInt(out.record.nonce) },
      signature: out.signature,
    });
    expect(signer).toBe(registrar.address);
  });

  test("a DNS domain from config: the label is what the account is called there", async () => {
    // The enclave signs into `x.com`, so the record is named `alice` inside that namespace rather than
    // being a bare handle beside the people.
    const { runtime } = fakeTeeRuntime();
    const out = JSON.parse(await onAttest(runtime, (await request({ domain: "x.com" })) as any));
    expect(out.record.domainName).toBe(toBytes32("x.com"));
    expect(out.record.name).toBe(toBytes32("alice"));
  });

  test("opted-in record: masked fields on chain, view code decryptable by the wallet", async () => {
    const { runtime } = fakeTeeRuntime();
    const out = JSON.parse(await onAttest(runtime, (await request({ optIn: true })) as any));
    expect(out.record.payload).not.toBe(zeroHash);
    const viewCode = bytesToHex(eciesDecrypt(USER_KEY, out.viewCode));
    expect(decodeRecord(out.record, viewCode)).toEqual({ handle: "alice", platformId: "1234567890123456789" });
  });

  test("name domain from config: handle becomes the label, answer the payload", async () => {
    const { runtime } = fakeTeeRuntime();
    const answer = toBytes32("terrible dictator");
    const out = JSON.parse(await onAttest(runtime, (await request({ domain: "kju-is", handle: "alice", payload: answer })) as any));
    expect(out.record.name).toBe(toBytes32("alice"));
    expect(out.record.payload).toBe(answer);
    expect(out.record.domainName).toBe(toBytes32("kju-is"));
  });

  test("renewal: nonce must beat the on-chain nonce read on the DON", async () => {
    const onchain = { exists: true, nonce: 3n, id: toBytes32("1234567890123456789"), wallet: user.account.address };
    await expect(onAttest(fakeTeeRuntime({ onchain }).runtime, (await request({ nonce: 3n })) as any)).rejects.toThrow(
      "nonce not increasing"
    );
    const out = JSON.parse(await onAttest(fakeTeeRuntime({ onchain }).runtime, (await request({ nonce: 4n })) as any));
    expect(out.record.nonce).toBe("4");
  });

  test("delivers to the relay when configured and reaches consensus on the ack", async () => {
    const cfg = { ...config, deliveryUrl: "https://relay.example/cre/delivery" };
    const { runtime, deliveries } = fakeTeeRuntime({ cfg });
    const out = await onAttest(runtime, (await request()) as any);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].url).toBe(cfg.deliveryUrl);
    expect(deliveries[0].body).toBe(out);
  });

  test("relay failure surfaces", async () => {
    const cfg = { ...config, deliveryUrl: "https://relay.example/cre/delivery" };
    const { runtime } = fakeTeeRuntime({ cfg, deliveryStatus: 500 });
    await expect(onAttest(runtime, (await request()) as any)).rejects.toThrow("delivery failed: HTTP 500");
  });

  test("rejects a token for another app before touching secrets", async () => {
    const { runtime, secretsRequested } = fakeTeeRuntime();
    const bad = await request({}, { aud: "other-app" });
    await expect(onAttest(runtime, bad as any)).rejects.toThrow("audience mismatch");
    expect(secretsRequested).toEqual(["REGISTRAR_KEY", "VIEWCODE_KEY"]);
  });

  test("rejects malformed wire input", () => {
    expect(() => parseRequest(stringToBytes('{"idToken":"x"}'))).toThrow();
    expect(() => parseRequest(stringToBytes("not json"))).toThrow();
  });
});

describe("writing the record as a DON report", () => {
  const REPORTER = "0xC7283bD9Aad1B08947C841536946Ce4dA9c99929";
  const withReporter = { ...config, reporter: REPORTER, reportGasLimit: "900000" } as Config;

  test("signs the record in the enclave, reports it from the DON, and returns the tx hash", async () => {
    const { runtime, reports, writes, deliveries } = fakeTeeRuntime({ cfg: withReporter });
    const out = JSON.parse(await onAttest(runtime, (await request()) as any));

    expect(writes).toEqual([{ receiver: REPORTER.toLowerCase(), gasLimit: "900000" }]);
    expect(out.txHash).toBe(`0x${"dd".repeat(32)}`);
    expect(deliveries).toHaveLength(0);

    // The payload the bridge decodes must carry the record and the registrar signature verbatim.
    const [record, signature] = decodeAbiParameters(
      parseAbiParameters(
        "(address wallet, bytes32 name, bytes32 id, uint96 nonce, bytes32 domainName, uint256 validUntil, bytes32 payload), bytes"
      ),
      reports[0] as Hex
    );
    expect(record.wallet).toBe(user.account.address);
    expect(record.name).toBe(toBytes32("alice"));
    expect(record.domainName).toBe(toBytes32("x"));
    expect(record.validUntil).toBe(BigInt(out.record.validUntil));
    expect(signature).toBe(out.signature);
    expect(
      await recoverTypedDataAddress({
        domain: { ...config.eip712, chainId: config.chainId, verifyingContract: config.multipass as Hex },
        types: registerNameTypes,
        primaryType: "registerName",
        message: { ...record },
        signature,
      })
    ).toBe(registrar.address);
  });

  test("a failed write is an error, not a silent success", async () => {
    const { runtime } = fakeTeeRuntime({ cfg: withReporter, txStatus: 1 });
    expect(onAttest(runtime, (await request()) as any)).rejects.toThrow(/report write failed/);
  });

  test("without a reporter nothing is written and the result carries no tx hash", async () => {
    const { runtime, writes } = fakeTeeRuntime();
    const out = JSON.parse(await onAttest(runtime, (await request()) as any));
    expect(writes).toHaveLength(0);
    expect(out.txHash).toBeUndefined();
  });

  test("encodeReport is stable for the same record", async () => {
    const { runtime } = fakeTeeRuntime();
    const out = JSON.parse(await onAttest(runtime, (await request()) as any));
    const result = {
      record: { ...out.record, validUntil: BigInt(out.record.validUntil), nonce: BigInt(out.record.nonce) },
      signature: out.signature,
      viewCode: undefined,
    };
    expect(encodeReport(result as never)).toBe(encodeReport(result as never));
  });
});

describe("onRegistered (log trigger)", () => {
  const PROVISION = "https://relay.example/v1/provision";

  /** A `Registered` log: domainName indexed, the record struct in data. */
  function registeredLog(handle: string) {
    return {
      data: encodeAbiParameters(
        parseAbiParameters(
          "(address wallet, bytes32 name, bytes32 id, uint96 nonce, bytes32 domainName, uint256 validUntil, bytes32 payload)"
        ),
        [
          {
            wallet: user.account.address,
            name: toBytes32(handle),
            id: toBytes32("id"),
            nonce: 1n,
            domainName: toBytes32("ketsuban"),
            validUntil: 1_800_000_000n,
            payload: zeroHash,
          },
        ]
      ),
    };
  }

  test("reads the handle out of the log and asks the relay to provision its vouch instance", () => {
    const { runtime, deliveries } = fakeTeeRuntime({ cfg: { ...config, provisionUrl: PROVISION } as Config });
    const don = (runtime as any).usingTheDons();
    expect(onRegistered(don, registeredLog("alice"))).toBe("~alice created");
    expect(deliveries).toEqual([{ url: PROVISION, body: JSON.stringify({ handle: "alice" }) }]);
  });

  test("handleFromLog strips the padding a bytes32 name carries", () => {
    expect(handleFromLog(registeredLog("bob"))).toBe("bob");
    expect(handleFromLog(registeredLog("a-very-long-handle-31-chars-xyz"))).toBe("a-very-long-handle-31-chars-xyz");
  });

  test("does nothing when no provisioning endpoint is configured", () => {
    const { runtime, deliveries } = fakeTeeRuntime();
    const don = (runtime as any).usingTheDons();
    expect(onRegistered(don, registeredLog("alice"))).toBe("provisioning disabled");
    expect(deliveries).toHaveLength(0);
  });

  test("a relay error surfaces", () => {
    const { runtime } = fakeTeeRuntime({
      cfg: { ...config, provisionUrl: PROVISION } as Config,
      deliveryStatus: 500,
    });
    const don = (runtime as any).usingTheDons();
    expect(() => onRegistered(don, registeredLog("alice"))).toThrow(/provision failed: HTTP 500/);
  });
});

describe("onDisclose", () => {
  const VIEW_CODE = `0x${"5a".repeat(32)}` as const;
  const holder = user.account.address;

  /** A masked record exactly as the attester publishes one, packed the way the resolver returns it. */
  function maskedRecord() {
    const record = {
      name: maskName("alice_x", VIEW_CODE),
      id: maskId("1234567890", VIEW_CODE),
      payload: viewCodeCommitment(VIEW_CODE),
    };
    return `0x${record.name.slice(2)}${record.id.slice(2)}${record.payload.slice(2)}` as Hex;
  }

  async function grant(over: { audience?: Hex; exp?: bigint; name?: string } = {}) {
    const registrarAccount = privateKeyToAccount(REGISTRAR_KEY);
    const box = eciesEncrypt(registrarAccount.publicKey, hexToBytes(VIEW_CODE), new Uint8Array(32).fill(4));
    const disclosure = {
      name: over.name ?? "alice.kju-is.eth",
      domain: "x",
      audience: (over.audience ?? `0x${"00".repeat(20)}`) as Hex,
      exp: over.exp ?? BigInt(NOW + 3600),
      boxHash: hashBox(box),
    };
    const signature = await signDisclosure(
      user.account,
      disclosure as never,
      discloseDomain(config.chainId, config.multipass as Hex)
    );
    return { ...disclosure, exp: disclosure.exp.toString(), box, signature };
  }

  const payload = async (over: Parameters<typeof grant>[0] = {}, extra: object = {}) => ({
    input: stringToBytes(
      JSON.stringify({
        name: "alice.kju-is.eth",
        domain: "x",
        packed: maskedRecord(),
        holder,
        grant: await grant(over),
        ...extra,
      })
    ),
  });

  test("answers the handle inside the enclave, and nothing else leaves", async () => {
    const { runtime, secretsRequested, evmCalls, deliveries } = fakeTeeRuntime();
    const out = JSON.parse(await onDisclose(runtime, (await payload()) as any));
    expect(out).toEqual({
      name: "alice.kju-is.eth",
      domain: "x",
      disclosed: { handle: "alice_x", platformId: "1234567890" },
    });
    // Only the registrar key is touched, and nothing is written or sent anywhere.
    expect(secretsRequested).toEqual(["REGISTRAR_KEY"]);
    expect(evmCalls).toHaveLength(0);
    expect(deliveries).toHaveLength(0);
  });

  test("refuses a grant for another record, an expired one, and one addressed elsewhere", async () => {
    const { runtime } = fakeTeeRuntime();
    expect(onDisclose(runtime, (await payload({ name: "bob.kju-is.eth" })) as any)).rejects.toThrow(
      "grant is for a different record"
    );
    expect(onDisclose(runtime, (await payload({ exp: BigInt(NOW - 1) })) as any)).rejects.toThrow("expired");
    expect(
      onDisclose(runtime, (await payload({ audience: registrar.address as Hex }, { reader: holder })) as any)
    ).rejects.toThrow("addressed to a different reader");
  });

  test("refuses a grant the record's holder did not sign", async () => {
    const { runtime } = fakeTeeRuntime();
    const wrongHolder = { ...(await payload()), input: undefined } as never;
    void wrongHolder;
    const body = JSON.parse(bytesToString((await payload()).input));
    const forged = { input: stringToBytes(JSON.stringify({ ...body, holder: registrar.address })) };
    expect(onDisclose(runtime, forged as any)).rejects.toThrow("not signed by the wallet that holds the record");
  });
});

describe("serializeResult", () => {
  test("stringifies bigints and nulls a missing view code", () => {
    const s = JSON.parse(
      serializeResult({
        record: { ...emptyRecord, validUntil: 5n, nonce: 2n },
        signature: "0x01",
      })
    );
    expect(s).toEqual({ record: { ...emptyRecord, validUntil: "5", nonce: "2" }, signature: "0x01", viewCode: null });
  });
});

describe("initWorkflow", () => {
  test("registers both enclave handlers and the root-domain log trigger", () => {
    const handlers = initWorkflow({ ...config, authorizedKeys: ["0x1111111111111111111111111111111111111111"] });
    expect(handlers).toHaveLength(3);
    expect(handlers.map((h) => h.fn)).toEqual([onAttest, onDisclose, onRegistered]);
    // Both enclave handlers ask for the same TEE; only the log trigger runs on the plain DON.
    expect(handlers[0].requirements).toBeDefined();
    expect(handlers[1].requirements).toBeDefined();
    const logTrigger = handlers[2].trigger as any;
    const b64 = (hex: string) => Buffer.from(hex.slice(2), "hex").toString("base64");
    expect(logTrigger.config.addresses.map((a: Uint8Array) => Buffer.from(a).toString("base64"))).toEqual([
      b64(config.multipass),
    ]);
    expect(
      logTrigger.config.topics.map((t: any) => t.values.map((v: Uint8Array) => Buffer.from(v).toString("base64")))
    ).toEqual([[b64(REGISTERED_TOPIC)], [b64(toBytes32(config.nameDomains[0]))]]);
    expect(handlers[0].fn).toBe(onAttest);
    expect(handlers[0].requirements).toBeDefined();
    const trigger = handlers[0].trigger as any;
    expect(trigger.config.authorizedKeys).toHaveLength(1);
    expect(trigger.config.authorizedKeys[0]).toMatchObject({ type: 1, publicKey: "0x1111111111111111111111111111111111111111" });
  });
});
