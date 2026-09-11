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
import { discloseDomain, eciesDecrypt, eciesEncrypt, hashBoxes, signDisclosure } from "@ketsuban/registrar";
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
  // The disclose handler takes the reader's identity from the request, so it refuses to answer a
  // workflow whose trigger is open to anyone. A deployment names its caller here.
  authorizedKeys: ["0x1111111111111111111111111111111111111111"],
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
  opts: {
    onchain?: OnchainFixture;
    deliveryStatus?: number;
    cfg?: Config;
    txStatus?: number;
    /** Whether the record the forwarder carried actually reached the chain */
    landed?: boolean;
  } = {}
) {
  const cfg = opts.cfg ?? config;
  const evmCalls: { to: string; args: unknown }[] = [];
  let wrote = false;
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
        // A forwarder reports its own transaction, not the receiver's outcome; `landed: false` is the
        // case where it succeeds and the record was never written.
        wrote = opts.landed !== false;
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
        // Once a write has landed the chain holds the record it wrote, which is what a read after it sees.
        const seen = wrote
          ? { exists: true, nonce: onchain.nonce + 1n, id: onchain.id, wallet: onchain.wallet }
          : { exists: onchain.exists, nonce: onchain.nonce, id: onchain.id, wallet: onchain.wallet };
        const encoded = encodeFunctionResult({
          abi: MultipassAbi,
          functionName: "resolveRecord",
          result: [seen.exists, { ...emptyRecord, nonce: seen.nonce, id: seen.id, wallet: seen.wallet }],
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

    /*
     * The other half of the claim, and the one the product makes to a person choosing to keep a handle
     * private: what lands on chain is not the handle. Proving it is readable with the view code says
     * nothing about whether it is readable without one, and masking that quietly became a no-op would
     * pass the assertion above unchanged.
     */
    expect(out.record.name).not.toBe(toBytes32("alice"));
    expect(out.record.id).not.toBe(toBytes32("1234567890123456789"));
    // Nor anywhere else in what leaves the enclave: the whole payload is searched, not just the fields
    // this test happens to know the names of.
    expect(JSON.stringify(out)).not.toContain(toBytes32("alice").slice(2, 20));
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

  test("refuses to report a write the forwarder swallowed", async () => {
    /*
     * Seen on Sepolia, tx 0x115f7217…: a handle already taken reverted inside the reporter, the
     * forwarder caught it and emitted its own failure, and the transaction still came back
     * successful — one log where a real write leaves three, and a fifth of the gas. `txStatus` is the
     * forwarder's outcome, never the receiver's, so believing it hands somebody a transaction hash
     * for a record that does not exist. Only the record can answer, so it is read back.
     */
    const { runtime, writes } = fakeTeeRuntime({ cfg: withReporter, landed: false });
    await expect(onAttest(runtime, (await request()) as any)).rejects.toThrow(
      /report delivered but no record was written/
    );
    // The write was attempted; what is refused is calling it a success.
    expect(writes).toHaveLength(1);
  });

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

  async function grant(
    over: { audience?: Hex; exp?: bigint; name?: string; domains?: string[] } = {}
  ) {
    const registrarAccount = privateKeyToAccount(REGISTRAR_KEY);
    const domains = over.domains ?? ["x"];
    // Each account has its own view code, and only `x`'s opens the record under test: a grant that
    // read the wrong box would decode to nonsense rather than quietly return the right answer.
    const boxes = domains.map((d, i) =>
      eciesEncrypt(
        registrarAccount.publicKey,
        hexToBytes(d === "x" ? VIEW_CODE : (`0x${"c3".repeat(32)}` as Hex)),
        new Uint8Array(32).fill(4 + i)
      )
    );
    const disclosure = {
      name: over.name ?? "alice.kju-is.eth",
      domains,
      audience: (over.audience ?? `0x${"00".repeat(20)}`) as Hex,
      audienceName: "",
      exp: over.exp ?? BigInt(NOW + 3600),
      boxesHash: hashBoxes(boxes),
    };
    const signature = await signDisclosure(
      user.account,
      disclosure as never,
      discloseDomain(config.chainId, config.multipass as Hex)
    );
    return { ...disclosure, exp: disclosure.exp.toString(), boxes, signature };
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

  test("opens the account asked about, not simply the first the grant names", async () => {
    // One signature can cover several accounts. Reading the wrong box would hand back one account's
    // handle under another account's name — the failure a verifier could never detect.
    const { runtime } = fakeTeeRuntime();
    const many = { domains: ["discord.com", "x"] };
    const out = JSON.parse(await onDisclose(runtime, (await payload(many)) as any));
    expect(out).toEqual({
      name: "alice.kju-is.eth",
      domain: "x",
      disclosed: { handle: "alice_x", platformId: "1234567890" },
    });

    // An account the grant does not name is refused, even though the signature itself is good.
    await expect(
      onDisclose(runtime, (await payload(many, { domain: "github.com" })) as any)
    ).rejects.toThrow(/different record/);
  });

  test("refuses a record that is not a linked account, rather than decoding whatever it is given", async () => {
    /*
     * `packed` comes from the caller. A masked linked-account record is three 32-byte words, and the
     * decoder reads it by position: handed a shorter value it would slice fields out of whatever it
     * got and answer with the result as though it were a handle.
     */
    const { runtime } = fakeTeeRuntime();
    const short = `0x${"11".repeat(32)}` as Hex;
    await expect(onDisclose(runtime, (await payload({}, { packed: short })) as any)).rejects.toThrow(
      "disclosure: not a linked-account record"
    );
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

    /*
     * The two enclave triggers are authorized differently, and it matters which way round.
     *
     * An attestation proves who made it — a wallet signature over the intent, and an identity token
     * listing that same wallet — and it is called straight from a browser, which can hold no key. So
     * that trigger is open, and restricting it would lock out every person the product is for.
     *
     * A disclosure proves nothing of the kind: it names its reader in the request and the enclave
     * cannot check that, so only a caller the deployment named may ask.
     */
    const attestTrigger = handlers[0].trigger as any;
    expect(attestTrigger.config.authorizedKeys ?? []).toHaveLength(0);

    const discloseTrigger = handlers[1].trigger as any;
    expect(discloseTrigger.config.authorizedKeys).toHaveLength(1);
    expect(discloseTrigger.config.authorizedKeys[0]).toMatchObject({
      type: 1,
      publicKey: "0x1111111111111111111111111111111111111111",
    });
  });
});

/**
 * The seam between this workflow and AttestationReporter.
 *
 * `encodeReport` names its fields in a hand-written list, and the contract decodes them as
 * `LibMultipass.Record`. Every field is a fixed 32-byte slot, so a list that drifted out of order
 * would decode without reverting and register a record whose wallet was its name — while both suites
 * carried on passing, each checking only its own side.
 *
 * The same bytes are asserted in packages/contracts/test/ReportEncoding.t.sol. Change the encoding and
 * one of the two fails, which is why this pins bytes and not a shape.
 */
/**
 * Who may ask the enclave to unmask an account.
 *
 * The handler decides from `reader` and `readerName` in the request, and cannot check either — the
 * schema says so itself: a name the *caller* has already proved. That model works only while the
 * caller is trusted, and an HTTP trigger with no authorized keys answers whoever has the URL. The two
 * settings have to agree, or a signed permission becomes a formality.
 */
describe("an open trigger cannot unmask an account", () => {
  test("refuses when the workflow authorizes nobody", async () => {
    const open = { ...config, authorizedKeys: [] } as Config;
    const { runtime } = fakeTeeRuntime({ cfg: open });
    await expect(onDisclose(runtime, { input: stringToBytes("{}") } as never)).rejects.toThrow(
      "Authorize the caller before exposing it"
    );
  });

  test("refuses before it reads the request, so a malformed one cannot tell them apart", async () => {
    // The guard is about who is asking, not what they asked for: it must not depend on the payload.
    const open = { ...config, authorizedKeys: [] } as Config;
    const { runtime } = fakeTeeRuntime({ cfg: open });
    await expect(onDisclose(runtime, { input: stringToBytes("not json") } as never)).rejects.toThrow(
      "Authorize the caller"
    );
  });
});

describe("what the enclave hands the reporter", () => {
  const VECTOR =
    ("0x000000000000000000000000ee4811b9462956c9c3535e79c08776d769ca9f3a" +
    "616c696365000000000000000000000000000000000000000000000000000000" +
    "3132333435363738393031323334353637383900000000000000000000000000" +
    "0000000000000000000000000000000000000000000000000000000000000007" +
    "7800000000000000000000000000000000000000000000000000000000000000" +
    "000000000000000000000000000000000000000000000000000000006aca5818" +
    "00000000000000000000000000000000000000000000000000000000000000ff" +
    "0000000000000000000000000000000000000000000000000000000000000100" +
    "0000000000000000000000000000000000000000000000000000000000000002" +
    "1234000000000000000000000000000000000000000000000000000000000000") as `0x${string}`;

  test("is the byte-for-byte report that contract decodes", () => {
    const encoded = encodeReport({
      record: {
        wallet: "0xEE4811b9462956C9C3535E79c08776D769CA9F3a",
        name: "0x616c696365000000000000000000000000000000000000000000000000000000",
        id: "0x3132333435363738393031323334353637383900000000000000000000000000",
        nonce: 7n,
        domainName: "0x7800000000000000000000000000000000000000000000000000000000000000",
        validUntil: 1791645720n,
        payload: "0x00000000000000000000000000000000000000000000000000000000000000ff",
      },
      signature: "0x1234",
    } as never);
    expect(encoded).toBe(VECTOR);
  });
});
