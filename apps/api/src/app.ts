import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { zeroHash, type Address, type Hex } from "viem";
import {
  attest,
  type AttestEnv,
  type AttestRequest,
  type AttestResult,
  type RegisterMessage,
} from "@ketsuban/registrar";
import { decodeRecord, fromBytes32, isOptedIn } from "@peeramid-labs/multipass-client";
import type { ChainReader, Instance } from "./chain.js";
import type { Config } from "./config.js";

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
  };
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

  const env = (): AttestEnv => ({
    now: now(),
    chainId: config.CHAIN_ID,
    multipass: config.MULTIPASS,
    eip712: { name: config.MULTIPASS_EIP712_NAME, version: config.MULTIPASS_EIP712_VERSION },
    privy: { appId: config.PRIVY_APP_ID, verificationKey: config.PRIVY_VERIFICATION_KEY_JWK },
    nameDomains: config.NAME_DOMAINS,
    termSeconds: config.RECORD_TERM_SECONDS,
  });

  app.get("/healthz", (c) => c.json({ ok: true, relayer: chain.relayer, chainId: config.CHAIN_ID }));

  app.get("/v1/instances", async (c) => c.json({ instances: await chain.instances() }));

  /** Current on-chain state for (wallet, domain): the browser needs the nonce to build an intent. */
  app.get("/v1/nonce", async (c) => {
    const wallet = c.req.query("wallet");
    const domain = c.req.query("domain");
    if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet) || !domain)
      return c.json({ error: "wallet and domain required" }, 400);
    const s = await chain.readOnchain(wallet as Address, domain);
    return c.json({
      exists: s.exists,
      nonce: s.nonce.toString(),
      next: (s.nonce + 1n).toString(),
      id: s.id,
      wallet: s.wallet,
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
    try {
      const onchain = await chain.readOnchain(req.intent.wallet, req.intent.domain);
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

  /** References written under a candidate: every record in the `<prefix><handle>` vouch domain. */
  app.get("/v1/vouches/:handle", async (c) => {
    const handle = c.req.param("handle").toLowerCase();
    if (!/^[a-z0-9-]{1,30}$/.test(handle)) return c.json({ error: "bad handle" }, 400);
    const domain = `${config.VOUCH_PREFIX}${handle}`;
    const rootParent =
      (await chain.instances()).find((i) => i.domain === config.NAME_DOMAINS[0])?.parentName ?? "";
    const records = await chain.listRecords(domain);
    return c.json({
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
      })),
      warning: WARNING,
    });
  });

  /**
   * Machine-readable verification (spec §3.4). Every field is read through the ENS resolver so an
   * agent gets exactly what any wallet would; `viewCode` (query) unmasks opted-in links.
   */
  app.get("/v1/verify/:name", async (c) => {
    const name = c.req.param("name");
    const located = locate(name, await chain.instances());
    if (!located) return c.json({ error: "unknown instance for name" }, 404);
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
    const linkDomains = (c.req.query("links") ?? "x,telegram,github,discord,google,email,linkedin")
      .split(",")
      .filter(Boolean);
    const viewCode = c.req.query("viewCode") as Hex | undefined;
    const links = active
      ? await Promise.all(
          linkDomains.map(async (domain) => {
            const packed = await chain.resolveData(r, name, `ketsuban:link:${domain}`);
            if (packed === "0x" || packed.length !== 194) return null;
            const record = {
              name: `0x${packed.slice(2, 66)}` as Hex,
              id: `0x${packed.slice(66, 130)}` as Hex,
              payload: `0x${packed.slice(130, 194)}` as Hex,
            };
            const optedIn = isOptedIn(record);
            let disclosed: { handle: string; platformId: string } | undefined;
            if (viewCode) {
              try {
                disclosed = decodeRecord(record, viewCode);
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
    return c.json({
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
    });
  });

  return app;
}
