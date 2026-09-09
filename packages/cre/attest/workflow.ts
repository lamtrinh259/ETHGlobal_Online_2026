import {
  bytesToBase64,
  bytesToHex,
  handler,
  consensusIdenticalAggregation,
  cre,
  encodeCallMsg,
  getNetwork,
  LATEST_BLOCK_NUMBER,
  ok,
  prepareReportRequest,
  TxStatus,
  type HTTPPayload,
  type HTTPSendRequester,
  type Runtime,
  type TeeRuntime,
} from "@chainlink/cre-sdk";
import {
  attestConfidential,
  verifyPublicLeg,
  type AttestEnv,
  type AttestRequest,
  type AttestResult,
  type OnchainState,
} from "@ketsuban/registrar";
import { MultipassAbi, toBytes32 } from "@peeramid-labs/multipass-client";
import {
  bytesToString,
  decodeAbiParameters,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  getAbiItem,
  hexToBytes,
  parseAbiParameters,
  stringToBytes,
  toEventSelector,
  type AbiEvent,
  zeroAddress,
  zeroHash,
  type Address,
  type Hex,
} from "viem";
import { z } from "zod";

// ─── Config ─────────────────────────────────────────────────
export const configSchema = z.object({
  chainSelectorName: z.string(),
  chainId: z.number().int(),
  multipass: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  eip712: z.object({ name: z.string(), version: z.string() }),
  privy: z.object({
    appId: z.string(),
    verificationKey: z.object({ kty: z.literal("EC"), crv: z.literal("P-256"), x: z.string(), y: z.string() }),
  }),
  /** Name domains are a deployment argument (e.g. ["kju-is"]) */
  nameDomains: z.array(z.string()).min(1),
  platformDomains: z.array(z.string()).optional(),
  termSeconds: z.number().int().positive().optional(),
  secretIds: z.object({ registrarKey: z.string(), viewcodeKey: z.string() }),
  /** EVM addresses allowed to fire the HTTP trigger; empty = open (simulation only) */
  authorizedKeys: z.array(z.string()).default([]),
  /** Optional relay that submits the record on chain; empty = return only */
  deliveryUrl: z.string().default(""),
  /**
   * Endpoint that provisions a candidate's vouch instance. With it set, a log trigger on the root
   * name domain drives provisioning from what the chain says, not from our own delivery call.
   */
  provisionUrl: z.string().default(""),
  /**
   * AttestationReporter to write the signed record to, as a DON report. Set it and the chain write
   * needs no key of ours: the enclave signs, the DON delivers, the reporter pays the domain fee.
   */
  reporter: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  reportGasLimit: z.string().regex(/^\d+$/).default("1200000"),
});
export type Config = z.infer<typeof configSchema>;

// ─── Wire format ────────────────────────────────────────────
const hex = z.string().regex(/^0x[0-9a-fA-F]*$/);
const wireSchema = z.object({
  idToken: z.string(),
  signature: hex,
  intent: z.object({
    wallet: hex,
    domain: z.string(),
    nonce: z.string().regex(/^\d+$/),
    exp: z.string().regex(/^\d+$/),
    optIn: z.boolean(),
    pubkey: hex,
    handle: z.string().default(""),
    payload: hex.default(zeroHash),
  }),
});

/** Parse the HTTP trigger body into an AttestRequest (bigints travel as decimal strings) */
export function parseRequest(input: Uint8Array): AttestRequest {
  const w = wireSchema.parse(JSON.parse(bytesToString(input)));
  return {
    idToken: w.idToken,
    signature: w.signature as Hex,
    intent: {
      wallet: w.intent.wallet as Address,
      domain: w.intent.domain,
      nonce: BigInt(w.intent.nonce),
      exp: BigInt(w.intent.exp),
      optIn: w.intent.optIn,
      pubkey: w.intent.pubkey as Hex,
      handle: w.intent.handle,
      payload: w.intent.payload as Hex,
    },
  };
}

/** The report the bridge decodes in `onReport`: the record and the registrar signature over it. */
export function encodeReport(result: AttestResult): Hex {
  return encodeAbiParameters(
    parseAbiParameters(
      "(address wallet, bytes32 name, bytes32 id, uint96 nonce, bytes32 domainName, uint256 validUntil, bytes32 payload), bytes"
    ),
    [
      {
        wallet: result.record.wallet,
        name: result.record.name,
        id: result.record.id,
        nonce: result.record.nonce,
        domainName: result.record.domainName,
        validUntil: result.record.validUntil,
        payload: result.record.payload,
      },
      result.signature,
    ]
  );
}

/**
 * Write the record through the DON: `runtime.report` has the nodes sign the payload, the
 * KeystoneForwarder delivers it to the reporter, and the reporter registers it. Returns the tx hash.
 */
export function writeRecord(donRuntime: Runtime<Config>, result: AttestResult): Hex {
  const config = donRuntime.config;
  const network = getNetwork({ chainSelectorName: config.chainSelectorName, isTestnet: true });
  if (!network) throw new Error(`unknown chain ${config.chainSelectorName}`);
  const report = donRuntime.report(prepareReportRequest(encodeReport(result))).result();
  const tx = new cre.capabilities.EVMClient(network.chainSelector.selector)
    .writeReport(donRuntime, {
      receiver: config.reporter as Address,
      report,
      gasConfig: { gasLimit: config.reportGasLimit },
    })
    .result();
  if (tx.txStatus !== TxStatus.SUCCESS) {
    throw new Error(`report write failed: ${tx.errorMessage || tx.txStatus}`);
  }
  return bytesToHex(tx.txHash ?? new Uint8Array(32));
}

/** JSON-safe result: bigints as decimal strings */
export function serializeResult(r: AttestResult, txHash?: Hex): string {
  return JSON.stringify({
    record: { ...r.record, validUntil: r.record.validUntil.toString(), nonce: r.record.nonce.toString() },
    signature: r.signature,
    viewCode: r.viewCode ?? null,
    ...(txHash ? { txHash } : {}),
  });
}

// ─── Public leg: chain read on the DON ──────────────────────
export function readOnchain(donRuntime: Runtime<Config>, req: AttestRequest): OnchainState {
  const config = donRuntime.config;
  const network = getNetwork({ chainSelectorName: config.chainSelectorName, isTestnet: true });
  if (!network) throw new Error(`unknown chain ${config.chainSelectorName}`);
  const evm = new cre.capabilities.EVMClient(network.chainSelector.selector);

  const data = encodeFunctionData({
    abi: MultipassAbi,
    functionName: "resolveRecord",
    args: [
      {
        name: zeroHash,
        id: zeroHash,
        wallet: req.intent.wallet,
        domainName: toBytes32(req.intent.domain),
        targetDomain: zeroHash,
      },
    ],
  });
  const reply = evm
    .callContract(donRuntime, {
      call: encodeCallMsg({ from: zeroAddress, to: config.multipass as Address, data }),
      blockNumber: LATEST_BLOCK_NUMBER,
    })
    .result();
  const [exists, record] = decodeFunctionResult({
    abi: MultipassAbi,
    functionName: "resolveRecord",
    data: bytesToHex(reply.data),
  });
  return { exists, nonce: record.nonce, id: record.id, wallet: record.wallet };
}

function envFrom(config: Config, now: Date): AttestEnv {
  return {
    now: Math.floor(now.getTime() / 1000),
    chainId: config.chainId,
    multipass: config.multipass as Address,
    eip712: config.eip712,
    privy: { appId: config.privy.appId, verificationKey: config.privy.verificationKey },
    nameDomains: config.nameDomains,
    platformDomains: config.platformDomains,
    termSeconds: config.termSeconds,
  };
}

// ─── Delivery (DON, consensus on the relay's acknowledgement) ─
const deliveryAck = z.object({ ok: z.boolean(), txHash: z.string().optional() });
type DeliveryAck = z.infer<typeof deliveryAck>;

export const deliver = (sendRequester: HTTPSendRequester, url: string, body: string): DeliveryAck => {
  const response = sendRequester
    .sendRequest({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: bytesToBase64(stringToBytes(body)),
      cacheSettings: { store: false },
    })
    .result();
  if (!ok(response)) throw new Error(`delivery failed: HTTP ${response.statusCode}`);
  return deliveryAck.parse(JSON.parse(bytesToString(response.body)));
};

// ─── Log trigger: a new root name provisions its vouch instance ───
const provisionAck = z.object({ handle: z.string(), domain: z.string(), created: z.boolean() });
type ProvisionAck = z.infer<typeof provisionAck>;

export const provision = (sendRequester: HTTPSendRequester, url: string, handle: string): ProvisionAck => {
  const response = sendRequester
    .sendRequest({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: bytesToBase64(stringToBytes(JSON.stringify({ handle }))),
      cacheSettings: { store: false },
    })
    .result();
  if (!ok(response)) throw new Error(`provision failed: HTTP ${response.statusCode}`);
  return provisionAck.parse(JSON.parse(bytesToString(response.body)));
};

/** The handle in a `Registered` log: the record struct is the log's only non-indexed field. */
export function handleFromLog(log: { data?: Uint8Array | string }): string {
  const data = typeof log.data === "string" ? (log.data as Hex) : bytesToHex(log.data ?? new Uint8Array());
  const [record] = decodeAbiParameters(
    parseAbiParameters(
      "(address wallet, bytes32 name, bytes32 id, uint96 nonce, bytes32 domainName, uint256 validUntil, bytes32 payload)"
    ),
    data
  );
  return bytesToString(hexToBytes(record.name)).replace(/\u0000+$/, "");
}

/**
 * Runs on the DON when a record lands in the root name domain. The candidate's vouch instance is a
 * consequence of their name existing, so the chain triggers it rather than our relay remembering to.
 */
export const onRegistered = (runtime: Runtime<Config>, log: { data?: Uint8Array | string }): string => {
  const url = runtime.config.provisionUrl;
  if (!url) return "provisioning disabled";
  const handle = handleFromLog(log);
  const ack = new cre.capabilities.HTTPClient()
    .sendRequest(runtime, provision, consensusIdenticalAggregation<ProvisionAck>())(url, handle)
    .result();
  return `${ack.domain} ${ack.created ? "created" : "exists"}`;
};

// ─── TEE handler ────────────────────────────────────────────
/**
 * Runs inside the enclave. Only the chain read and the optional delivery cross to the DON;
 * the identity token, both secrets and the view-code preimages never leave.
 */
export const onAttest = async (runtime: TeeRuntime<Config>, payload: HTTPPayload): Promise<string> => {
  const config = runtime.config;
  const req = parseRequest(payload.input);
  const env = envFrom(config, runtime.now());

  const donRuntime = runtime.usingTheDons();
  const onchain = readOnchain(donRuntime, req);
  await verifyPublicLeg(req, onchain, env);

  const secrets = {
    registrarKey: runtime.getSecret({ id: config.secretIds.registrarKey }).result().value as Hex,
    viewcodeKey: runtime.getSecret({ id: config.secretIds.viewcodeKey }).result().value as Hex,
  };
  const result = await attestConfidential(req, onchain.exists ? onchain.id : zeroHash, secrets, env);
  const txHash = config.reporter ? writeRecord(donRuntime, result) : undefined;
  const out = serializeResult(result, txHash);

  if (config.deliveryUrl) {
    new cre.capabilities.HTTPClient()
      .sendRequest(donRuntime, deliver, consensusIdenticalAggregation<DeliveryAck>())(config.deliveryUrl, out)
      .result();
  }
  return out;
};

export function initWorkflow(config: Config) {
  const http = new cre.capabilities.HTTPCapability();
  const network = getNetwork({ chainSelectorName: config.chainSelectorName, isTestnet: true });
  if (!network) throw new Error(`unknown chain ${config.chainSelectorName}`);
  const evm = new cre.capabilities.EVMClient(network.chainSelector.selector);
  const registered = toEventSelector(getAbiItem({ abi: MultipassAbi, name: "Registered" }) as AbiEvent);
  const b64 = (hex: Hex) => bytesToBase64(hexToBytes(hex));
  return [
    cre.handlerInTee(
      http.trigger({
        authorizedKeys: config.authorizedKeys.map((publicKey) => ({ type: "KEY_TYPE_ECDSA_EVM", publicKey })),
      }),
      onAttest,
      [{ tee: "nitro", regions: ["us-west-2"] }]
    ),
    // `Registered(bytes32 indexed domainName, Record)` in the root name domain.
    handler(
      evm.logTrigger({
        addresses: [b64(config.multipass as Hex)],
        topics: [{ values: [b64(registered)] }, { values: [b64(toBytes32(config.nameDomains[0]))] }],
      }),
      onRegistered
    ),
  ];
}
