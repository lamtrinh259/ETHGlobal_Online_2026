import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { bytesToHex, keccak256, stringToBytes, zeroHash, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  candidateOf,
  attest,
  checkAudience,
  checkDisclosure,
  discloseDomain,
  eciesDecrypt,
  recoverDiscloseSigner,
  RESERVED_HANDLES,
  signRecord,
  type SignedDisclosure,
  type AttestEnv,
  type AttestRequest,
  type AttestResult,
  type RegisterMessage,
  type OnchainState,
} from "@ketsuban/registrar";
import { decodeRecord, fromBytes32, isOptedIn, toBytes32 } from "@peeramid-labs/multipass-client";
import type { ChainReader, Instance } from "./chain.js";
import type { Config } from "./config.js";
import { PersistentMap, PersistentSet } from "./store.js";

const hex = z.string().regex(/^0x[0-9a-fA-F]*$/);
const decimal = z.string().regex(/^\d+$/);

export const wireRequest = z.object({
  idToken: z.string(),
  signature: hex,
  intent: z.object({
    wallet: hex,
    domain: z.string(),
    nonce: decimal,
    exp: decimal,
    optIn: z.boolean(),
    pubkey: hex,
    handle: z.string().default(""),
    payload: hex.default(zeroHash),
  }),
  /** Vouch domains: the candidate's invitation, as the browser received it */
  invite: z.object({ handle: z.string(), voucher: hex, exp: decimal, signature: hex }).optional(),
});

export const wireRecord = z.object({
  name: hex,
  id: hex,
  domainName: hex,
  validUntil: decimal,
  nonce: decimal,
  wallet: hex,
  payload: hex,
});

export const wireDisclosure = z.object({
  name: z.string(),
  domain: z.string(),
  audience: hex,
  exp: decimal,
  boxHash: hex,
  box: z.object({ ephemeralPubkey: hex, nonce: hex, ciphertext: hex }),
  signature: hex,
});

export const wireDelivery = z.object({
  record: wireRecord,
  signature: hex,
  viewCode: z.object({ ephemeralPubkey: hex, nonce: hex, ciphertext: hex }).nullable().optional(),
});

export function toRequest(w: z.infer<typeof wireRequest>): AttestRequest {
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
    ...(w.invite
      ? {
          invite: {
            handle: w.invite.handle,
            voucher: w.invite.voucher as Address,
            exp: BigInt(w.invite.exp),
            signature: w.invite.signature as Hex,
          },
        }
      : {}),
  };
}

/**
 * Text that was meant to be read, or nothing. Multipass stores 31 bytes either way: a handle and an
 * answer are words, a masked name and a view-code commitment are bytes that only look like words.
 */
export function readable(value: string): string | undefined {
  if (value === "") return undefined;
  // eslint-disable-next-line no-control-regex
  return /^[\x20-\x7e]+$/.test(value) ? value : undefined;
}

export function toRecord(w: z.infer<typeof wireRecord>): RegisterMessage {
  return {
    name: w.name as Hex,
    id: w.id as Hex,
    domainName: w.domainName as Hex,
    validUntil: BigInt(w.validUntil),
    nonce: BigInt(w.nonce),
    wallet: w.wallet as Address,
    payload: w.payload as Hex,
  };
}

export function serialize(r: AttestResult) {
  return {
    record: { ...r.record, validUntil: r.record.validUntil.toString(), nonce: r.record.nonce.toString() },
    signature: r.signature,
    viewCode: r.viewCode ?? null,
  };
}

export const WARNING =
  "This is not identity, employment, safety, malware, nationality, or affiliation verification.";

export type AppDeps = { config: Config; chain: ChainReader; now?: () => number };

/** Split `<handle>.<parentName>` against the known instances */
export function locate(
  name: string,
  instances: Instance[]
): { handle: string; instance: Instance } | undefined {
  const lower = name.toLowerCase();
  for (const instance of instances) {
    const suffix = `.${instance.parentName.toLowerCase()}`;
    if (lower.endsWith(suffix)) {
      const handle = lower.slice(0, -suffix.length);
      if (handle && !handle.includes(".")) return { handle, instance };
    }
  }
  return undefined;
}

export function createApp({ config, chain, now = () => Math.floor(Date.now() / 1000) }: AppDeps) {
  const app = new Hono();
  app.use(
    "*",
    cors({
      origin: config.CORS_ORIGINS.includes("*") ? "*" : config.CORS_ORIGINS,
      allowHeaders: ["content-type", "x-delivery-token"],
      allowMethods: ["GET", "POST", "OPTIONS"],
    })
  );

  /**
   * Why a record in `domain` cannot be written, or null. A vouch domain is the exception to
   * "must exist": it is created from the first signed record, which is how an organisation writes for
   * someone who has no name yet.
   */
  async function writeBlocker(domain: string): Promise<string | null> {
    const ready = await chain.domainReady(domain);
    const provisionable = candidateOf(domain, [config.VOUCH_PREFIX]) !== undefined;
    if (!ready.initialised)
      return provisionable ? null : `domain "${domain}" is not initialised on Multipass`;
    if (!ready.active) return `domain "${domain}" is not active on Multipass`;
    if (!ready.registrarOk) return `this attester is not the registrar for "${domain}"`;
    return null;
  }

  /**
   * The public leg needs the candidate's wallet for a vouch domain: the invitation has to be signed
   * by whoever holds that name, and only the chain can say who that is.
   */
  async function readFor(req: AttestRequest): Promise<OnchainState> {
    const onchain = await chain.readOnchain(req.intent.wallet, req.intent.domain);
    const candidate = candidateOf(req.intent.domain, [config.VOUCH_PREFIX]);
    if (!candidate || !config.NAME_DOMAINS[0]) return onchain;
    const [status, org] = await Promise.all([
      chain.nameStatus(config.NAME_DOMAINS[0], candidate),
      // An organisation needs no invitation, so whether this wallet is one is part of the public leg.
      chain.readOnchain(req.intent.wallet, config.ORG_DOMAIN),
    ]);
    return {
      ...onchain,
      candidateWallet: status.live ? (status.wallet ?? undefined) : undefined,
      issuerOrg: org.exists,
    };
  }

  const env = (): AttestEnv => ({
    now: now(),
    chainId: config.CHAIN_ID,
    multipass: config.MULTIPASS,
    eip712: { name: config.MULTIPASS_EIP712_NAME, version: config.MULTIPASS_EIP712_VERSION },
    privy: { appId: config.PRIVY_APP_ID, verificationKey: config.PRIVY_VERIFICATION_KEY_JWK },
    nameDomains: config.NAME_DOMAINS,
    nameDomainPrefixes: [config.VOUCH_PREFIX],
    orgDomain: config.ORG_DOMAIN,
    termSeconds: config.RECORD_TERM_SECONDS,
    requireInvite: config.REQUIRE_INVITE,
  });

  app.get("/healthz", (c) =>
    c.json({ ok: true, relayer: chain.relayer, chainId: config.CHAIN_ID, index: chain.indexStatus() })
  );

  /** Instances plus the two contracts a wallet writes to directly (profile records, own-name alias). */
  /** What the configured addresses actually are on chain; read this before blaming a signature. */
  app.get("/v1/preflight", async (c) => {
    try {
      const p = await chain.preflight();
      return c.json(p, p.ok ? 200 : 503);
    } catch (e) {
      return c.json({ ok: false, warnings: [(e as Error).message] }, 502);
    }
  });

  app.get("/v1/instances", async (c) =>
    c.json({
      instances: await chain.instances(),
      bridge: config.BRIDGE,
      permissionedResolver: config.PERMISSIONED_RESOLVER ?? null,
    })
  );

  /** Current on-chain state for (wallet, domain): the browser needs the nonce to build an intent. */
  app.get("/v1/nonce", async (c) => {
    const wallet = c.req.query("wallet");
    const domain = c.req.query("domain");
    if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet) || !domain)
      return c.json({ error: "wallet and domain required" }, 400);
    const [s, reason] = await Promise.all([
      chain.readOnchain(wallet as Address, domain),
      writeBlocker(domain),
    ]);
    return c.json({
      exists: s.exists,
      nonce: s.nonce.toString(),
      next: (s.nonce + 1n).toString(),
      id: s.id,
      wallet: s.wallet,
      // The browser asks for a nonce right before it signs, so this is where it learns not to.
      ready: reason === null,
      reason,
    });
  });

  /**
   * Node registrar fallback (spec B.9.7): same input and byte-identical output as the enclave.
   * Enabled only when REGISTRAR_KEY / VIEWCODE_KEY are configured.
   */
  app.post("/v1/attest", async (c) => {
    if (!config.REGISTRAR_KEY || !config.VIEWCODE_KEY) return c.json({ error: "registrar disabled" }, 501);
    const parsed = wireRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "bad request", issues: parsed.error.issues }, 400);
    const req = toRequest(parsed.data);
    // Refuse before signing: a domain this attester cannot write produces a revert later, and the
    // signature the user already gave is wasted either way.
    const blocker = await writeBlocker(req.intent.domain);
    if (blocker) return c.json({ error: blocker }, 503);
    try {
      const onchain = await readFor(req);
      const result = await attest(
        req,
        onchain,
        { registrarKey: config.REGISTRAR_KEY, viewcodeKey: config.VIEWCODE_KEY },
        env()
      );
      return c.json(serialize(result));
    } catch (e) {
      return c.json({ error: (e as Error).message }, 422);
    }
  });

  /**
   * Submit a registrar-signed record from a browser. No secret: the record is only accepted because
   * the registrar signed it, so relaying someone else's signed record writes exactly what they asked
   * for and nothing more. The token-gated delivery route stays for the enclave, which also asks for
   * the candidate's vouch instance to be provisioned.
   */
  app.post("/v1/submit", async (c) => {
    const parsed = wireDelivery.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ ok: false, error: "bad request", issues: parsed.error.issues }, 400);
    try {
      const record = toRecord(parsed.data.record);
      await ensureVouchDomain(record);
      const txHash = await chain.submit(record, parsed.data.signature as Hex);
      return c.json({ ok: true, txHash });
    } catch (e) {
      return c.json({ ok: false, error: (e as Error).message }, 502);
    }
  });

  /** CRE external delivery: submit a registrar-signed record through the bridge. */
  app.post("/v1/cre/delivery", async (c) => {
    if (config.DELIVERY_TOKEN && c.req.header("x-delivery-token") !== config.DELIVERY_TOKEN) {
      return c.json({ ok: false, error: "unauthorized" }, 401);
    }
    const parsed = wireDelivery.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ ok: false, error: "bad request", issues: parsed.error.issues }, 400);
    try {
      const record = toRecord(parsed.data.record);
      const txHash = await chain.submit(record, parsed.data.signature as Hex);
      // A newly claimed root name gets its vouch instance so others can write references under it.
      let vouchInstance: { domain: string; created: boolean } | undefined;
      if (config.NAME_DOMAINS[0] && fromBytes32(record.domainName) === config.NAME_DOMAINS[0]) {
        try {
          vouchInstance = await chain.ensureVouchInstance(fromBytes32(record.name));
        } catch (e) {
          vouchInstance = undefined;
          console.error(
            JSON.stringify({
              msg: "vouch instance provisioning failed",
              handle: fromBytes32(record.name),
              error: (e as Error).message,
            })
          );
        }
      }
      return c.json({ ok: true, txHash, ...(vouchInstance ? { vouchInstance } : {}) });
    } catch (e) {
      return c.json({ ok: false, error: (e as Error).message }, 502);
    }
  });

  /**
   * A reference for someone who has not claimed a name yet has nowhere to land: the candidate's vouch
   * instance is created when their own name arrives. An organisation writes before that, so the
   * instance follows the signed record rather than the name. The registrar already approved the write,
   * which for an uninvited one means the writer is an onboarded organisation.
   */
  async function ensureVouchDomain(record: RegisterMessage): Promise<void> {
    const domain = fromBytes32(record.domainName);
    const candidate = candidateOf(domain, [config.VOUCH_PREFIX]);
    if (!candidate) return;
    const known = (await chain.instances()).some((i) => i.domain === domain);
    if (known) return;
    await chain.ensureVouchInstance(candidate);
  }

  /**
   * The key a candidate encrypts a view code to. It is the registrar's own public key, which lives in
   * the enclave, so a disclosure can be opened there and nowhere else. Public by definition.
   */
  app.get("/v1/enclave-key", (c) => {
    if (!config.REGISTRAR_KEY) return c.json({ error: "registrar disabled" }, 501);
    const account = privateKeyToAccount(config.REGISTRAR_KEY);
    return c.json({ address: account.address, publicKey: account.publicKey });
  });

  /**
   * A candidate's permission to read one masked account. The grant carries the view code encrypted to
   * the enclave key and a signature from the wallet that holds the record, so storing it here gives
   * this service no ability it did not already have: only the registrar key can open the box.
   */
  const grantStore = new PersistentMap<SignedDisclosure>(
    "disclosures",
    config.DATA_DIR || undefined,
    (raw) => {
      const g = raw as Omit<SignedDisclosure, "exp"> & { exp: string };
      return { ...g, exp: BigInt(g.exp) };
    },
    (grant) => ({ ...grant, exp: grant.exp.toString() })
  );
  app.post("/v1/disclose", async (c) => {
    const body = wireDisclosure.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "bad request", issues: body.error.issues }, 400);
    const grant: SignedDisclosure = {
      name: body.data.name.toLowerCase(),
      domain: body.data.domain,
      audience: body.data.audience as Address,
      exp: BigInt(body.data.exp),
      boxHash: body.data.boxHash as Hex,
      box: {
        ephemeralPubkey: body.data.box.ephemeralPubkey as Hex,
        nonce: body.data.box.nonce as Hex,
        ciphertext: body.data.box.ciphertext as Hex,
      },
      signature: body.data.signature as Hex,
    };
    const located = locate(grant.name, await chain.instances());
    if (!located) return c.json({ error: "unknown instance for name" }, 404);
    const holder = await chain.resolveAddr(located.instance.resolver, grant.name);
    try {
      const signer = await recoverDiscloseSigner(
        {
          name: grant.name,
          domain: grant.domain,
          audience: grant.audience,
          exp: grant.exp,
          boxHash: grant.boxHash,
        },
        grant.signature,
        discloseDomain(config.CHAIN_ID, config.MULTIPASS)
      );
      checkDisclosure(grant, { holder, now: now(), signer });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 422);
    }
    const key = `${grant.name}:${grant.domain}`;
    grantStore.set(key, grant);
    return c.json({
      ok: true,
      name: grant.name,
      domain: grant.domain,
      expiresAt: new Date(Number(grant.exp) * 1000).toISOString(),
    });
  });

  /**
   * Read a masked account the candidate allowed. The handle is never written anywhere: the enclave
   * opens the view code, decodes the record and answers this one question.
   */
  app.get("/v1/disclose/:name/:domain", async (c) => {
    if (!config.REGISTRAR_KEY) return c.json({ error: "registrar disabled" }, 501);
    const name = c.req.param("name").toLowerCase();
    const domain = c.req.param("domain");
    const grant = grantStore.get(`${name}:${domain}`);
    if (!grant) return c.json({ error: "no disclosure for that account" }, 404);
    const reader = c.req.query("reader") as Address | undefined;
    const located = locate(name, await chain.instances());
    if (!located) return c.json({ error: "unknown instance for name" }, 404);
    const holder = await chain.resolveAddr(located.instance.resolver, name);
    try {
      const signer = await recoverDiscloseSigner(
        {
          name: grant.name,
          domain: grant.domain,
          audience: grant.audience,
          exp: grant.exp,
          boxHash: grant.boxHash,
        },
        grant.signature,
        discloseDomain(config.CHAIN_ID, config.MULTIPASS)
      );
      checkDisclosure(grant, { holder, now: now(), signer });
      checkAudience(grant, reader);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 403);
    }
    const packed = await chain.resolveData(located.instance.resolver, name, `ketsuban:link:${domain}`);
    if (packed === "0x" || packed.length !== 194) return c.json({ error: "no record for that account" }, 404);
    try {
      const viewCode = bytesToHex(eciesDecrypt(config.REGISTRAR_KEY, grant.box));
      const disclosed = decodeRecord(
        {
          name: `0x${packed.slice(2, 66)}` as Hex,
          id: `0x${packed.slice(66, 130)}` as Hex,
          payload: `0x${packed.slice(130, 194)}` as Hex,
        },
        viewCode
      );
      return c.json({ name, domain, disclosed, warning: WARNING });
    } catch (e) {
      return c.json({ error: `could not open the disclosure: ${(e as Error).message}` }, 422);
    }
  });

  /**
   * Onboard an organisation: give a wallet a record in `ORG_DOMAIN` so it can issue references
   * uninvited. Operator-only by design — the uninvited path is safe only because somebody vouched for
   * the organisation itself — so it needs `ORG_TOKEN` and no identity token, the subject being a
   * wallet rather than a person.
   */
  app.post("/v1/org", async (c) => {
    if (!config.ORG_TOKEN || !config.REGISTRAR_KEY) return c.json({ error: "org onboarding disabled" }, 501);
    if (c.req.header("x-org-token") !== config.ORG_TOKEN) return c.json({ error: "unauthorized" }, 401);
    const body = z
      .object({
        wallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
        label: z.string().regex(/^[a-z0-9-]{1,31}$/),
      })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "wallet and label required" }, 400);

    const { wallet, label } = body.data;
    const ready = await chain.domainReady(config.ORG_DOMAIN);
    if (!ready.initialised || !ready.active)
      return c.json({ error: `domain "${config.ORG_DOMAIN}" is not usable` }, 503);
    if (!ready.registrarOk)
      return c.json({ error: `this service is not the registrar for "${config.ORG_DOMAIN}"` }, 503);

    const onchain = await chain.readOnchain(wallet as Address, config.ORG_DOMAIN);
    const record: RegisterMessage = {
      name: toBytes32(label),
      // An organisation is a wallet, not a DID, so its id comes from the label it registers.
      id: keccak256(stringToBytes(`org:${label}`)),
      domainName: toBytes32(config.ORG_DOMAIN),
      validUntil: BigInt(now() + config.RECORD_TERM_SECONDS),
      nonce: onchain.nonce + 1n,
      wallet: wallet as Address,
      payload: zeroHash,
    };
    try {
      const signature = await signRecord(record, config.REGISTRAR_KEY, env());
      const txHash = await chain.submit(record, signature);
      return c.json({ ok: true, label, wallet, txHash, renewal: onchain.exists });
    } catch (e) {
      return c.json({ ok: false, error: (e as Error).message }, 502);
    }
  });

  /**
   * Provision a candidate's vouch instance. Idempotent, and open on purpose: it only acts for a
   * handle that already holds a live record in the root name domain, which the chain decides, so the
   * Chainlink log-trigger workflow can call it without a shared secret.
   */
  app.post("/v1/provision", async (c) => {
    const body = z
      .object({ handle: z.string().regex(/^[a-z0-9-]{1,30}$/) })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "handle required" }, 400);
    const handle = body.data.handle;
    const rootDomain = config.NAME_DOMAINS[0];
    if (!rootDomain) return c.json({ error: "no root name domain configured" }, 501);
    const status = await chain.nameStatus(rootDomain, handle);
    if (!status.live) return c.json({ error: `${handle}.${rootDomain} holds no live record` }, 403);
    try {
      return c.json({ handle, ...(await chain.ensureVouchInstance(handle)) });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  });

  /**
   * Resolve a name through the ENSv2 UniversalResolver: the same answer any wallet or indexer gets,
   * with the resolver it reached. Independent of our instance bookkeeping on purpose.
   */
  const ENS_KEYS = [
    "ketsuban:answer",
    "ketsuban:expiry",
    "ketsuban:humanity",
    "avatar",
    "description",
    "url",
  ];
  app.get("/v1/ens/:name", async (c) => {
    if (!config.UNIVERSAL_RESOLVER) return c.json({ error: "universal resolver not configured" }, 501);
    const name = c.req.param("name").toLowerCase();
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(name)) return c.json({ error: "bad name" }, 400);
    const keys = (c.req.query("keys") ?? ENS_KEYS.join(",")).split(",").filter(Boolean).slice(0, 10);
    try {
      const { resolver, addr, texts } = await chain.resolveUniversal(name, keys);
      const active = addr !== "0x0000000000000000000000000000000000000000";
      return c.json({
        name,
        universalResolver: config.UNIVERSAL_RESOLVER,
        resolver,
        addr: active ? addr : null,
        texts,
        status: active ? "active" : "inactive",
        warning: WARNING,
      });
    } catch (e) {
      return c.json({ name, error: (e as Error).message.slice(0, 200) }, 502);
    }
  });

  /** Is a handle free in a domain? The browser asks before the wallet signs. */
  app.get("/v1/name/:domain/:handle", async (c) => {
    const domain = c.req.param("domain");
    const handle = c.req.param("handle").toLowerCase();
    if (!/^[a-z0-9-]{1,31}$/.test(handle)) return c.json({ error: "bad handle" }, 400);
    // A reserved label is not free even when no record holds it: a platform namespace answers there.
    const reserved = config.NAME_DOMAINS.includes(domain) && RESERVED_HANDLES.includes(handle);
    const status = await chain.nameStatus(domain, handle);
    return c.json({ domain, handle, ...status, reserved, taken: status.taken || reserved });
  });

  /**
   * What an address is called. Multipass holds the record, so the resolver can answer the reverse
   * question without any reverse registry: useful to a verifier who has an address and nothing else.
   */
  app.get("/v1/reverse/:address", async (c) => {
    const address = c.req.param("address");
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return c.json({ error: "bad address" }, 400);
    const instances = await chain.instances();
    const named = await Promise.all(
      instances
        .filter((i) => config.NAME_DOMAINS.includes(i.domain))
        .map(async (i) => ({
          domain: i.domain,
          name: await chain.reverseName(i.resolver, address as Address).catch(() => ""),
          resolver: i.resolver,
        }))
    );
    const found = named.filter((n) => n.name !== "");
    return c.json({
      address,
      name: found[0]?.name ?? null,
      names: found,
      note: "answered from the Multipass record, not from a reverse registry",
      warning: WARNING,
    });
  });

  /** A wallet's dashboard: its names per domain and the references it has given (`<prefix>*` domains). */
  app.get("/v1/wallet/:address", async (c) => {
    const address = c.req.param("address");
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return c.json({ error: "bad address" }, 400);
    const instances = await chain.instances();
    const parentOf = new Map(instances.map((i) => [i.domain, i.parentName]));
    // Every platform domain has its own instance now, so an instance no longer means "a name domain".
    // Classify by configuration, which is what decides whether a record carries a handle and an answer.
    const isNameDomain = (d: string) => config.NAME_DOMAINS.includes(d);
    const rootParent = parentOf.get(config.NAME_DOMAINS[0] ?? "") ?? "";
    // The index lists a wallet's whole history; a candidate's own names come straight from the chain so
    // the page is right even while a backfill is still running.
    const [indexed, balance, direct] = await Promise.all([
      chain.listRecordsByWallet(address as Address),
      chain.balance(address as Address),
      Promise.all(config.NAME_DOMAINS.map((d) => chain.recordFor(address as Address, d))),
    ]);
    const records = [...indexed];
    for (const r of direct) {
      if (r && !records.some((k) => k.domain === r.domain && k.id === r.id)) records.push(r);
    }
    const isVouch = (d: string) => d.startsWith(config.VOUCH_PREFIX) && d.length > config.VOUCH_PREFIX.length;
    const hasLiveName = records.some((r) => r.live && isNameDomain(r.domain));
    const fmt = (r: (typeof records)[number]) => ({
      domain: r.domain,
      // A masked record's name and payload are ciphertext and a commitment: decoding them as text
      // produces mojibake that reads like corruption rather than like privacy working.
      name: readable(r.name) ?? "",
      payload: readable(fromBytes32(r.payload)) ?? "",
      validUntil: new Date(Number(r.validUntil) * 1000).toISOString(),
      nonce: r.nonce.toString(),
      live: r.live,
    });
    // An organisation is a wallet with a record in ORG_DOMAIN; the browser needs it to know whether
    // this voucher may write uninvited.
    const org = records.find((r) => r.domain === config.ORG_DOMAIN && r.live);
    return c.json({
      address,
      org: org
        ? { label: org.name, validUntil: new Date(Number(org.validUntil) * 1000).toISOString() }
        : null,
      names: records
        .filter((r) => isNameDomain(r.domain))
        .map((r) => ({ ...fmt(r), ensName: `${r.name}.${parentOf.get(r.domain)}` })),
      links: records
        .filter((r) => !isNameDomain(r.domain) && !isVouch(r.domain) && r.domain !== config.ORG_DOMAIN)
        .map((r) => {
          const optedIn = r.payload !== zeroHash;
          const parent = parentOf.get(r.domain);
          // A public account is a name any ENS client can read — when its handle can be a label at all.
          // An email address cannot: `@` and `.` separate labels, they are not characters in one.
          // Underscores are fine in an ENS label and common in platform handles; `@` and `.` are not.
          const label = /^[a-z0-9_-]{1,63}$/.test(r.name.toLowerCase()) ? r.name.toLowerCase() : null;
          return {
            ...fmt(r),
            optedIn,
            ensName: parent && !optedIn && label ? `${label}.${parent}` : null,
            // Why there is no name, when there is none: privacy, or a handle that cannot be a label.
            nameless: optedIn ? "private" : label ? null : "not-a-label",
          };
        }),
      given: records
        .filter((r) => isVouch(r.domain))
        .map((r) => {
          const candidate = r.domain.slice(config.VOUCH_PREFIX.length);
          return {
            ...fmt(r),
            candidate,
            ensName: rootParent ? `${r.name}.${candidate}.${rootParent}` : null,
          };
        }),
      balance: balance.toString(),
      gasTopup: {
        enabled: config.GAS_TOPUP_WEI > 0n,
        amount: config.GAS_TOPUP_WEI.toString(),
        available: config.GAS_TOPUP_WEI > 0n && hasLiveName && balance < config.GAS_TOPUP_WEI,
      },
      warning: WARNING,
    });
  });

  /**
   * Test-gas for the two transactions a wallet sends itself (profile records, own-name alias).
   * Once per wallet per process, only for wallets that hold a live name and sit below the amount.
   */
  const toppedUp = new PersistentSet("gas-topups", config.DATA_DIR || undefined);
  app.post("/v1/gas", async (c) => {
    if (config.GAS_TOPUP_WEI === 0n) return c.json({ error: "gas top-up disabled" }, 501);
    const body = z
      .object({ wallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/) })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "wallet required" }, 400);
    const wallet = body.data.wallet as Address;
    const key = wallet.toLowerCase();
    if (toppedUp.has(key)) return c.json({ error: "already topped up" }, 409);
    const instances = await chain.instances();
    const nameDomains = new Set(instances.map((i) => i.domain));
    const isVouch = (d: string) => d.startsWith(config.VOUCH_PREFIX) && d.length > config.VOUCH_PREFIX.length;
    const records = await chain.listRecordsByWallet(wallet);
    if (!records.some((r) => r.live && nameDomains.has(r.domain) && !isVouch(r.domain)))
      return c.json({ error: "wallet holds no live name" }, 403);
    if ((await chain.balance(wallet)) >= config.GAS_TOPUP_WEI)
      return c.json({ error: "wallet has enough gas" }, 409);
    toppedUp.add(key);
    const hash = await chain.sendEth(wallet, config.GAS_TOPUP_WEI);
    return c.json({ hash, amount: config.GAS_TOPUP_WEI.toString() });
  });

  /** References written under a candidate: every record in the `<prefix><handle>` vouch domain. */
  const isVouchDomain = (d: string) =>
    d.startsWith(config.VOUCH_PREFIX) && d.length > config.VOUCH_PREFIX.length;

  /** A handle's standing in the reference graph: live references given by its wallet and received under it. */
  async function standing(handle: string): Promise<{ claimed: boolean; given: number; received: number }> {
    const rootDomain = config.NAME_DOMAINS[0] ?? "";
    const status = await chain.nameStatus(rootDomain, handle);
    const received = new Set(
      (await chain.listRecords(`${config.VOUCH_PREFIX}${handle}`)).filter((r) => r.live).map((r) => r.name)
    ).size;
    if (!status.live || !status.wallet) return { claimed: false, given: 0, received };
    const given = new Set(
      (await chain.listRecordsByWallet(status.wallet))
        .filter((r) => r.live && isVouchDomain(r.domain))
        .map((r) => r.domain)
    ).size;
    return { claimed: true, given, received };
  }

  app.get("/v1/standing/:handle", async (c) => {
    const handle = c.req.param("handle").toLowerCase();
    if (!/^[a-z0-9-]{1,30}$/.test(handle)) return c.json({ error: "bad handle" }, 400);
    return c.json({ handle, ...(await standing(handle)), warning: WARNING });
  });

  /** Every reference written under a candidate, with each live voucher's standing and letter. */
  async function vouchesFor(handle: string) {
    const domain = `${config.VOUCH_PREFIX}${handle}`;
    const rootParent =
      (await chain.instances()).find((i) => i.domain === config.NAME_DOMAINS[0])?.parentName ?? "";
    const records = await chain.listRecords(domain);
    const vouchers = [...new Set(records.filter((r) => r.live).map((r) => r.name))];
    const standings = new Map(await Promise.all(vouchers.map(async (v) => [v, await standing(v)] as const)));
    // The letter is an ENS text record the voucher writes themselves on their vouch name.
    const vouchInstance = (await chain.instances()).find((i) => i.domain === domain);
    const letters = new Map(
      vouchInstance
        ? await Promise.all(
            vouchers.map(
              async (v) =>
                [
                  v,
                  await chain
                    .resolveText(vouchInstance.resolver, `${v}.${vouchInstance.parentName}`, "description")
                    .catch(() => ""),
                ] as const
            )
          )
        : []
    );
    return {
      handle,
      domain,
      vouches: records.map((r) => ({
        voucher: r.name,
        voucherName: rootParent ? `${r.name}.${rootParent}` : null,
        wallet: r.wallet,
        statement: fromBytes32(r.payload),
        validUntil: new Date(Number(r.validUntil) * 1000).toISOString(),
        nonce: r.nonce.toString(),
        live: r.live,
        standing: standings.get(r.name) ?? null,
        letter: letters.get(r.name) || null,
      })),
      warning: WARNING,
    };
  }

  app.get("/v1/vouches/:handle", async (c) => {
    const handle = c.req.param("handle").toLowerCase();
    if (!/^[a-z0-9-]{1,30}$/.test(handle)) return c.json({ error: "bad handle" }, 400);
    return c.json(await vouchesFor(handle));
  });

  /**
   * Machine-readable verification (spec §3.4). Every field is read through the ENS resolver so an
   * agent gets exactly what any wallet would; `viewCode` (query) unmasks opted-in links.
   */
  /**
   * One name, read through the instance resolver. Shared by `/v1/verify/:name` and the composed
   * profile: an agent should get the same bytes either way.
   */
  async function verifyName(
    name: string,
    opts: { linkDomains: string[]; viewCode?: Hex }
  ): Promise<Record<string, unknown> | undefined> {
    const located = locate(name, await chain.instances());
    if (!located) return undefined;
    const { instance } = located;
    const r = instance.resolver;

    const [wallet, answer, expiry, humanity, humanityUntil, avatar, description, url, email] =
      await Promise.all([
        chain.resolveAddr(r, name),
        chain.resolveText(r, name, "ketsuban:answer"),
        chain.resolveText(r, name, "ketsuban:expiry"),
        chain.resolveText(r, name, "ketsuban:humanity"),
        chain.resolveText(r, name, "ketsuban:humanity:until"),
        // ENS profile records the user writes on the stock PermissionedResolver (bridge grants ROLE_SET_TEXT)
        chain.resolveText(r, name, "avatar"),
        chain.resolveText(r, name, "description"),
        chain.resolveText(r, name, "url"),
        chain.resolveText(r, name, "email"),
      ]);
    const active = wallet !== "0x0000000000000000000000000000000000000000";
    const links = active
      ? await Promise.all(
          opts.linkDomains.map(async (domain) => {
            const packed = await chain.resolveData(r, name, `ketsuban:link:${domain}`);
            if (packed === "0x" || packed.length !== 194) return null;
            const record = {
              name: `0x${packed.slice(2, 66)}` as Hex,
              id: `0x${packed.slice(66, 130)}` as Hex,
              payload: `0x${packed.slice(130, 194)}` as Hex,
            };
            const optedIn = isOptedIn(record);
            let disclosed: { handle: string; platformId: string } | undefined;
            if (opts.viewCode) {
              try {
                disclosed = decodeRecord(record, opts.viewCode);
              } catch {
                disclosed = undefined;
              }
            }
            return {
              domain,
              optedIn,
              ...(optedIn ? { commitment: record.payload } : {}),
              ...(disclosed ? { disclosed } : {}),
            };
          })
        )
      : [];

    const evidence = [
      "wallet_binding",
      ...(humanity ? ["humanity_attestation"] : []),
      ...links.filter(Boolean).map((l) => `${l!.domain}_account_control`),
    ];
    return {
      name,
      instance: { domain: instance.domain, parentName: instance.parentName },
      status: active ? "active" : "inactive",
      wallet: active ? wallet : null,
      answer: active ? answer : null,
      expiresAt: expiry ? new Date(Number(expiry) * 1000).toISOString() : null,
      humanity: humanity
        ? {
            level: humanity,
            until: humanityUntil ? new Date(Number(humanityUntil) * 1000).toISOString() : null,
          }
        : null,
      links: links.filter(Boolean),
      profile: {
        avatar: avatar || null,
        description: description || null,
        url: url || null,
        email: email || null,
      },
      evidence,
      decision: active ? "additional_context_available" : "no_record",
      warning: WARNING,
    };
  }

  const DEFAULT_LINKS = "x,telegram,github,discord,google,email,linkedin";
  const linkQuery = (q?: string) => (q ?? DEFAULT_LINKS).split(",").filter(Boolean);

  app.get("/v1/verify/:name", async (c) => {
    const v = await verifyName(c.req.param("name"), {
      linkDomains: linkQuery(c.req.query("links")),
      viewCode: c.req.query("viewCode") as Hex | undefined,
    });
    if (!v) return c.json({ error: "unknown instance for name" }, 404);
    return c.json(v);
  });

  /**
   * The whole candidate in one read: every instance name, the references written for them, and each
   * voucher's standing. Facts only — grading against a policy is the reader's job, never ours.
   */
  app.get("/v1/profile/:handle", async (c) => {
    const handle = c.req.param("handle").toLowerCase();
    if (!/^[a-z0-9-]{1,30}$/.test(handle)) return c.json({ error: "bad handle" }, 400);
    const instances = await chain.instances();
    const subjects = instances.filter((i) => config.NAME_DOMAINS.includes(i.domain));
    if (subjects.length === 0) return c.json({ error: "no name domains configured" }, 501);
    const opts = {
      linkDomains: linkQuery(c.req.query("links")),
      viewCode: c.req.query("viewCode") as Hex | undefined,
    };
    const names = await Promise.all(
      subjects.map(async (i) => ({
        instance: i.domain,
        name: `${handle}.${i.parentName}`,
        verification: (await verifyName(`${handle}.${i.parentName}`, opts)) ?? null,
      }))
    );
    const vouches = await vouchesFor(handle);
    return c.json({
      handle,
      names,
      vouches: vouches.vouches,
      standing: await standing(handle),
      warning: WARNING,
    });
  });

  return app;
}
