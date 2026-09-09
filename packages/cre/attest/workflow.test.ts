import { describe, expect, test } from "bun:test";
import type { TeeRuntime } from "@chainlink/cre-sdk";
import { baseIntent, fakePrivy, fakeUser, signedAttestRequest, toWire } from "@ketsuban/registrar/testing";
import { decodeRecord, MultipassAbi, registerNameTypes, toBytes32 } from "@peeramid-labs/multipass-client";
import {
  bytesToHex,
  decodeAbiParameters,
  decodeFunctionData,
  encodeFunctionResult,
  parseAbiParameters,
  recoverTypedDataAddress,
  stringToBytes,
  zeroHash,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { eciesDecrypt } from "@ketsuban/registrar";
import { encodeReport, initWorkflow, onAttest, parseRequest, serializeResult, type Config } from "./workflow";

const NOW = 1_800_000_000;
const REGISTRAR_KEY = "0x000000000000000000000000000000000000000000000000000000000000b0b0" as const;
const VIEWCODE_KEY = "0x1111111111111111111111111111111111111111111111111111111111111111" as const;
const USER_KEY = "0x000000000000000000000000000000000000000000000000000000000000a11c" as const;
const privy = fakePrivy("cltest-app-id");
const user = fakeUser(USER_KEY);
const registrar = privateKeyToAccount(REGISTRAR_KEY);

const config: Config = {
  chainSelectorName: "ethereum-testnet-sepolia",
  chainId: 11155111,
  multipass: "0x418F82fd0014a4CA402F145978bfaF0555a9cA06",
  eip712: { name: "MultipassDNS", version: "1.0.0" },
  privy: { appId: privy.appId, verificationKey: privy.jwk },
  nameDomains: ["kju-is"],
  secretIds: { registrarKey: "REGISTRAR_KEY", viewcodeKey: "VIEWCODE_KEY" },
  authorizedKeys: [],
  deliveryUrl: "",
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
        deliveries.push({ url: payload.url, body: Buffer.from(asBytes(payload.body)).toString() });
        return {
          result: () => ({
            statusCode: opts.deliveryStatus ?? 200,
            body: stringToBytes(JSON.stringify({ ok: true, txHash: "0xabc" })),
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
  const BRIDGE = "0xC7283bD9Aad1B08947C841536946Ce4dA9c99929";
  const withBridge = { ...config, bridge: BRIDGE, reportGasLimit: "900000" } as Config;

  test("signs the record in the enclave, reports it from the DON, and returns the tx hash", async () => {
    const { runtime, reports, writes, deliveries } = fakeTeeRuntime({ cfg: withBridge });
    const out = JSON.parse(await onAttest(runtime, (await request()) as any));

    expect(writes).toEqual([{ receiver: BRIDGE.toLowerCase(), gasLimit: "900000" }]);
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
    const { runtime } = fakeTeeRuntime({ cfg: withBridge, txStatus: 1 });
    expect(onAttest(runtime, (await request()) as any)).rejects.toThrow(/report write failed/);
  });

  test("without a bridge nothing is written and the result carries no tx hash", async () => {
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
  test("registers one HTTP handler inside a Nitro enclave", () => {
    const handlers = initWorkflow({ ...config, authorizedKeys: ["0x1111111111111111111111111111111111111111"] });
    expect(handlers).toHaveLength(1);
    expect(handlers[0].fn).toBe(onAttest);
    expect(handlers[0].requirements).toBeDefined();
    const trigger = handlers[0].trigger as any;
    expect(trigger.config.authorizedKeys).toHaveLength(1);
    expect(trigger.config.authorizedKeys[0]).toMatchObject({ type: 1, publicKey: "0x1111111111111111111111111111111111111111" });
  });
});
