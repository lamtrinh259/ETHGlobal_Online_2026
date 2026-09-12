import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import {
  bytesToHex,
  getAddress,
  keccak256,
  stringToBytes,
  zeroAddress,
  zeroHash,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  candidateOf,
  solicitedBy,
  attest,
  checkAudience,
  LINK_KEY_RE,
  linkKeyHash,
  checkDisclosure,
  checkRevocation,
  discloseDomain,
  grantId,
  eciesDecrypt,
  recoverDiscloseSigner,
  recoverInviteSigner,
  recoverRevokeSigner,
  RESERVED_HANDLES,
  signRecord,
  inviteDomain,
  type SignedDisclosure,
  type SignedInvite,
  PLATFORM_DOMAIN_NAMES,
  type AttestEnv,
  type AttestRequest,
  type AttestResult,
  type RegisterMessage,
  type OnchainState,
} from "@ketsuban/registrar";
import { decodeRecord, fromBytes32, isOptedIn, maskName, toBytes32 } from "@peeramid-labs/multipass-client";
import {
  explainName,
  forPreview,
  HANDLE_RE,
  isDnsName,
  platformOf,
  policyInviteDomain,
  previewId,
  recoverPolicyInviteSigner,
  storable,
  WITHDRAWN,
  type SignedPolicyInvite,
} from "@ketsuban/registrar";
import {
  neighbourhood,
  personMetrics,
  referenceGraph,
  sybilRank,
  sybilScore,
  type ReferenceGraph,
} from "./graph.js";
import { councilFrom, Readings, summarise, type Reading } from "./council.js";
import type { ChainReader, Instance } from "./chain.js";
import { explainRevert } from "./errors.js";
import type { Config } from "./config.js";
import { PersistentMap, PersistentSet, VOLATILE_WITHOUT_DATA_DIR } from "./store.js";
import { commitFromEnv } from "./commit.js";
import { humanityRecordId, signRequest, verifyHumanProof, worldFrom, type Fetch } from "./world.js";

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
  invite: z
    .object({
      handle: z.string(),
      voucher: hex,
      exp: decimal,
      requires: z.array(z.string()).max(8).default([]),
      signature: hex,
    })
    .optional(),
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
  domains: z.array(z.string()).min(1).max(16),
  audience: hex,
  audienceName: z.string().max(255).default(""),
  exp: decimal,
  boxesHash: hex,
  boxes: z
    .array(z.object({ ephemeralPubkey: hex, nonce: hex, ciphertext: hex }))
    .min(1)
    .max(16),
  /*
   * The hash of the secret a link-shared grant is opened by.
   *
   * Not part of the signature: it says nothing about what is permitted, only about who is holding the
   * link, and the holder's browser keeps the secret itself. A grant for one named reader needs none —
   * that reader is who it opens for.
   */
  linkKeyHash: hex.optional(),
  signature: hex,
});

export const wireInvite = z.object({
  handle: z.string(),
  voucher: hex,
  exp: decimal,
  requires: z.array(z.string()).max(8).default([]),
  signature: hex,
});

export const wireRevocation = z.object({
  name: z.string(),
  grantId: hex,
  at: decimal,
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
            requires: w.invite.requires,
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

export type AppDeps = {
  config: Config;
  chain: ChainReader;
  now?: () => number;
  /** How proofs reach World; an argument so a test can answer as the Developer Portal does */
  fetch?: Fetch;
};

/** Split `<handle>.<parentName>` against the known instances */
/**
 * The ENS name a linked account answers at: the account's own where it is public, and the person's in
 * the private branch where it is not. Shared by the dashboard and by reverse resolution, so both say
 * the same thing about the same record.
 */
export function linkName(
  record: { name: string; payload: string },
  mount: Instance | undefined,
  held: string | undefined
): { ensName: string | null; nameless: string | null } {
  const optedIn = record.payload !== zeroHash;
  const label = /^[a-z0-9_-]{1,63}$/.test(record.name.toLowerCase()) ? record.name.toLowerCase() : null;
  const masked = optedIn && mount?.maskedParentName && held ? `${held}.${mount.maskedParentName}` : null;
  const open = !optedIn && label && mount?.parentName ? `${label}.${mount.parentName}` : null;
  const ensName = open ?? masked;
  return {
    ensName,
    // Why there is no name, when there is none: privacy, or a handle that cannot be a label.
    nameless: ensName ? null : optedIn ? "private" : label ? null : "not-a-label",
  };
}

export function locate(
  name: string,
  instances: Instance[]
): { handle: string; instance: Instance; resolver: Address; masked?: true } | undefined {
  const lower = name.toLowerCase();
  const under = (parent: string | undefined) => {
    if (!parent) return undefined;
    const suffix = `.${parent.toLowerCase()}`;
    if (!lower.endsWith(suffix)) return undefined;
    const handle = lower.slice(0, -suffix.length);
    return handle && !handle.includes(".") ? handle : undefined;
  };
  for (const instance of instances) {
    const handle = under(instance.parentName);
    if (handle) return { handle, instance, resolver: instance.resolver };
  }
  // A name in the private branch belongs to the person, not to the account: it answers from the mirror,
  // which reads the root record and says only that they have an account here.
  for (const instance of instances) {
    const handle = under(instance.maskedParentName);
    if (handle && instance.maskedResolver)
      return { handle, instance, resolver: instance.maskedResolver, masked: true };
  }
  return undefined;
}

export function createApp({
  config,
  chain,
  now = () => Math.floor(Date.now() / 1000),
  fetch: fetchImpl = fetch,
}: AppDeps) {
  const app = new Hono();
  /*
   * A preview API answers its preview's web app.
   *
   * The origins configured are production's; a preview is the same image served under a pull
   * request's own host, and the web app it belongs to sits under the same id. So each origin is
   * allowed with that id in front of it as well — in production there is no id, and the list is
   * exactly what was configured.
   */
  const servedAt = config.COOLIFY_FQDN || config.COOLIFY_URL || undefined;
  const preview = previewId(servedAt) ?? null;
  const origins = [...new Set(config.CORS_ORIGINS.flatMap((o) => [o, forPreview(o, servedAt)]))];
  app.use(
    "*",
    cors({
      origin: origins.includes("*") ? "*" : origins,
      // `x-view-code` carries a secret that must not be in a URL, so the browser has to be
      // allowed to send it: without this the preflight refuses and every masked read fails.
      allowHeaders: ["content-type", "x-delivery-token", "x-view-code"],
      allowMethods: ["GET", "POST", "OPTIONS"],
    })
  );

  /** The World ID app this deployment proves humanity with, or nothing when it has none. */
  const world = worldFrom(config);

  /**
   * Why a record in `domain` cannot be written, or null. A vouch domain is the exception to
   * "must exist": it is created from the first signed record, which is how an organisation writes for
   * someone who has no name yet.
   */
  /**
   * A DNS domain nobody has deployed yet is not a dead end: the relay builds its namespace on demand,
   * the way it provisions a candidate's vouch instance. Only the operator pays, so the request has to
   * have proved itself first — this runs after the attester has verified the identity token and that
   * the account really was issued by that domain.
   */
  /**
   * What this deployment may do with a DNS domain nobody has mounted here. `write` is any domain the
   * chain already holds — the record is writable exactly as it is, whatever this service knows about
   * mounts — and `mount` is the rest, which the relay builds on demand.
   */
  async function namespacePlan(domain: string): Promise<{ write: boolean; mount: boolean }> {
    if (!isDnsName(domain) || !platformOf(domain)) return { write: false, mount: false };
    const ready = await chain.domainReady(domain);
    if (ready.initialised) return { write: true, mount: false };
    return { write: !!config.NAMESPACE_FACTORY, mount: !!config.NAMESPACE_FACTORY };
  }

  async function writeBlocker(domain: string): Promise<string | null> {
    const ready = await chain.domainReady(domain);
    const provisionable =
      candidateOf(domain, [config.VOUCH_PREFIX]) !== undefined || (await namespacePlan(domain)).mount;
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
    // An invitation may ask the writer to have attested a workplace or a university address, which is
    // only checkable against what they actually hold.
    const held = await chain.listRecordsByWallet(req.intent.wallet);
    return {
      ...onchain,
      candidateWallet: status.live ? (status.wallet ?? undefined) : undefined,
      writerDomains: held.filter((r) => r.live).map((r) => r.domain),
      issuerOrg: org.exists,
    };
  }

  /**
   * What the attester may write into. The deployment decides: a platform mounted at its own DNS name is
   * `x.com` here, and a mail host is whichever ones were deployed. The flat platform names stay allowed
   * for a deployment that predates the namespace, where a record is written before any mount exists.
   */
  const env = async (): Promise<AttestEnv> => ({
    platformDomains: [
      ...new Set([...(await chain.instances()).map((i) => i.domain), ...PLATFORM_DOMAIN_NAMES]),
    ],
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

  /**
   * What this process is actually pointed at. Half of every deployment problem is one variable naming
   * the wrong contract, and the only way to see it from outside is to be told. Addresses are public;
   * a secret is reported as set or unset and never by value, and the RPC URL is left out because it
   * carries an API key.
   */
  function configReport() {
    const optional = {
      REGISTRY: config.REGISTRY,
      PERMISSIONED_RESOLVER: config.PERMISSIONED_RESOLVER,
      UNIVERSAL_RESOLVER: config.UNIVERSAL_RESOLVER,
      NAMESPACE_FACTORY: config.NAMESPACE_FACTORY,
      ETH_REGISTRY: config.ETH_REGISTRY,
      REGISTRAR_ADDRESS: config.REGISTRAR_ADDRESS,
    };
    return {
      chainId: config.CHAIN_ID,
      // The platform rule: a reference is written by one real person. Off only on a test stack.
      vouchRequiresHumanity: selfieCheckRequired(),
      multipass: config.MULTIPASS,
      bridge: config.BRIDGE,
      factory: config.FACTORY,
      namespaceFactory: config.NAMESPACE_FACTORY ?? null,
      // Set, the tree is read from Multipass through this one resolver rather than from the factory.
      rootResolver: config.ROOT_RESOLVER ?? null,
      registry: config.REGISTRY ?? null,
      permissionedResolver: config.PERMISSIONED_RESOLVER ?? null,
      universalResolver: config.UNIVERSAL_RESOLVER ?? null,
      ethRegistry: config.ETH_REGISTRY ?? null,
      registrarAddress: config.REGISTRAR_ADDRESS ?? null,
      relayer: chain.relayer,
      nameDomains: config.NAME_DOMAINS,
      orgDomain: config.ORG_DOMAIN,
      humanityDomain: config.HUMANITY_DOMAIN,
      // Identifiers, never the key: this one signs proof requests as the app itself.
      world: world
        ? { appId: world.appId, rpId: world.rpId, action: world.action, environment: world.environment }
        : null,
      vouchPrefix: config.VOUCH_PREFIX,
      deployBlock: String(config.DEPLOY_BLOCK),
      privyAppId: config.PRIVY_APP_ID,
      // Grants and gas top-ups are the state this service owns. Without a directory they are held in
      // memory, and a redeploy takes every permission with it; with one that cannot be written, the
      // same thing happens while everything still looks fine.
      storage: { dataDir: config.DATA_DIR || null, ...grantStore.health() },
      secrets: {
        relayerKey: !!config.RELAYER_KEY,
        registrarKey: !!config.REGISTRAR_KEY,
        viewcodeKey: !!config.VIEWCODE_KEY,
        deliveryToken: !!config.DELIVERY_TOKEN,
        orgToken: !!config.ORG_TOKEN,
        adminToken: !!config.ADMIN_TOKEN,
        privyVerificationKey: !!config.PRIVY_VERIFICATION_KEY_JWK,
        worldSigningKey: !!config.WORLD_RP_SIGNING_KEY,
      },
      missing: Object.entries(optional)
        .filter(([, v]) => !v)
        .map(([k]) => k),
    };
  }

  /**
   * A picture for a profile. ENS text records hold a URL, not bytes, so the picture has to live
   * somewhere this service can serve it from — which means `DATA_DIR`, or the record would dangle
   * after the next restart.
   *
   * What is stored is decided by the bytes, never by the name or the declared type: an HTML page
   * announcing itself as a PNG, served back from this origin, would run as a page on it. The file is
   * named by the hash of its own content, so nothing a caller sends becomes part of a path.
   */
  const AVATAR_MAX = 2_000_000;
  const PICTURES: { ext: string; type: string; magic: number[] }[] = [
    { ext: "png", type: "image/png", magic: [0x89, 0x50, 0x4e, 0x47] },
    { ext: "jpg", type: "image/jpeg", magic: [0xff, 0xd8, 0xff] },
    { ext: "gif", type: "image/gif", magic: [0x47, 0x49, 0x46, 0x38] },
  ];
  const pictureOf = (bytes: Uint8Array) => {
    const known = PICTURES.find((p) => p.magic.every((b, i) => bytes[i] === b));
    if (known) return known;
    // WEBP is `RIFF....WEBP`, so its mark is split in two.
    const riff = [0x52, 0x49, 0x46, 0x46].every((b, i) => bytes[i] === b);
    const webp = [0x57, 0x45, 0x42, 0x50].every((b, i) => bytes[8 + i] === b);
    return riff && webp ? { ext: "webp", type: "image/webp", magic: [] } : undefined;
  };
  const avatarDir = () => join(config.DATA_DIR, "avatars");

  app.post("/v1/avatar", async (c) => {
    if (!config.DATA_DIR) {
      return c.json(
        { error: "no DATA_DIR: there is nowhere to keep a picture that outlives a restart" },
        501
      );
    }
    const body = await c.req.parseBody().catch(() => null);
    const file = body?.["file"];
    if (!(file instanceof File)) return c.json({ error: "send a picture as `file`" }, 400);
    if (file.size > AVATAR_MAX) {
      return c.json({ error: `a picture must be under ${AVATAR_MAX / 1_000_000}MB` }, 413);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const picture = pictureOf(bytes);
    if (!picture) return c.json({ error: "that is not a picture this service can serve" }, 415);

    const id = `${createHash("sha256").update(bytes).digest("hex")}.${picture.ext}`;
    try {
      mkdirSync(avatarDir(), { recursive: true });
      writeFileSync(join(avatarDir(), id), bytes);
    } catch (e) {
      // A DATA_DIR with no volume behind it fails here first, and an unhandled throw says nothing to
      // whoever has to fix the deployment.
      return c.json(
        { error: `DATA_DIR (${config.DATA_DIR}) cannot be written: ${(e as Error).message}` },
        503
      );
    }
    /*
     * The scheme a reader will actually use.
     *
     * This URL goes into an `avatar` text record and stays there: the record is permanent, and so is
     * whatever scheme was written into it. Behind a proxy that terminates TLS the request arrives as
     * plain http, so building the URL from it records `http://…` for a page served over https — mixed
     * content, which a strict browser refuses to load and no later fix can rewrite.
     */
    const url = new URL(`/v1/avatar/${id}`, c.req.url);
    const proto = c.req.header("x-forwarded-proto")?.split(",")[0]?.trim();
    if (proto === "https" || proto === "http") url.protocol = `${proto}:`;
    return c.json({ id, url: url.toString() });
  });

  app.get("/v1/avatar/:id", (c) => {
    const id = c.req.param("id");
    // The only names that exist are ones this service made: a hash and a known extension.
    const known = /^[0-9a-f]{64}\.(png|jpg|gif|webp)$/.exec(id);
    if (!known || !config.DATA_DIR) return c.json({ error: "no such picture" }, 404);
    const picture = PICTURES.find((p) => p.ext === known[1]) ?? { type: "image/webp" };
    try {
      const bytes = readFileSync(join(avatarDir(), id));
      return c.body(bytes as unknown as ArrayBuffer, 200, {
        "content-type": picture.type,
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
        "cache-control": "public, max-age=31536000, immutable",
      });
    } catch {
      return c.json({ error: "no such picture" }, 404);
    }
  });

  // Read once: the environment does not change under a running process, and a probe should not pay
  // for the answer on every call.
  const commit = commitFromEnv();

  app.get("/healthz", (c) =>
    c.json({
      ok: true,
      relayer: chain.relayer,
      chainId: config.CHAIN_ID,
      // Which commit is serving. An empty sha with a named source says the platform passed one this
      // build does not read; "none" says it passed none at all.
      commit: commit.sha,
      commitFrom: commit.from,
      // Which pull request's preview this is, or null in production: what the web app of the same
      // preview is being answered for.
      preview,
      index: chain.indexStatus(),
      config: configReport(),
    })
  );

  /** Instances plus the two contracts a wallet writes to directly (profile records, own-name alias). */
  /** What the configured addresses actually are on chain; read this before blaming a signature. */
  app.get("/v1/preflight", async (c) => {
    try {
      const p = await chain.preflight();
      // Storage is not on chain, but a deployment that cannot keep a permission is misconfigured in
      // exactly the way this endpoint exists to report.
      const store = grantStore.health();
      const index = chain.indexStatus();
      const warnings = [
        ...p.warnings,
        ...(store.durable ? [] : [`DATA_DIR is not set: ${VOLATILE_WITHOUT_DATA_DIR}`]),
        ...(store.durable && !store.writable
          ? [`DATA_DIR cannot be written (${store.lastError}): nothing kept here survives a restart`]
          : []),
        /*
         * The index is where every list in the product comes from, and both of its failures are quiet.
         * One serves stale answers while the service looks healthy; the other costs nothing until the
         * next restart and then reads the whole history again with the product blank. Neither is worth
         * detecting if nothing says so where a deployment is inspected.
         */
        ...(index.lastError
          ? [
              `the index has not read the chain for ${index.staleForSeconds ?? "?"}s (${index.lastError}): ` +
                `every list is answered from what it held when it stopped`,
            ]
          : []),
        ...(index.snapshotError
          ? [
              `the index cannot write its snapshot (${index.snapshotError}): it still serves, and the ` +
                `next restart reads the whole history again`,
            ]
          : []),
      ];
      return c.json({ ...p, warnings }, p.ok ? 200 : 503);
    } catch (e) {
      return c.json({ ok: false, warnings: [(e as Error).message] }, 502);
    }
  });

  app.get("/v1/instances", async (c) =>
    c.json({
      instances: await chain.instances(),
      bridge: config.BRIDGE,
      permissionedResolver: config.PERMISSIONED_RESOLVER ?? null,
      rootResolver: config.ROOT_RESOLVER ?? null,
      ethRegistry: config.ETH_REGISTRY ?? null,
      // The registrar mints only to its caller and the names do not transfer, so registering is
      // something the person's own wallet does; the browser needs these two addresses to do it.
      ethRegistrar: config.ETH_REGISTRAR ?? null,
      paymentToken: config.PAYMENT_TOKEN ?? null,
      // Whether a proof of humanity can be asked for at all. Unconfigured, those routes answer 501,
      // and a button or a step that leads there is a dead end.
      humanity: selfieCheckOffered(),
    })
  );

  /**
   * What a name would claim here, whether or not anything resolves at it. An agent handed a name needs to
   * tell "nobody holds this" from "this could never mean anything in this deployment", and the answer
   * comes from the same function the app reads, so the two can never drift.
   */
  app.get("/v1/explain/:name", async (c) => {
    const name = c.req.param("name");
    const claim = explainName(name, await chain.instances(), config.NAME_DOMAINS);
    return c.json({ name, ...claim, warning: WARNING });
  });

  /**
   * Who owns a `.eth` label on the registry the bridge checks. A name held on another ENS deployment
   * is not here at all, which is the whole answer someone needs before paying for a reverted call.
   */
  app.get("/v1/eth-label/:label", async (c) => {
    const label = c.req.param("label").toLowerCase();
    if (!/^[a-z0-9-]{1,63}$/.test(label)) return c.json({ error: "bad label" }, 400);
    if (!config.ETH_REGISTRY) return c.json({ error: "no eth registry configured" }, 501);
    try {
      const owner = await chain.ethLabelOwner(label);
      return c.json({
        label,
        registry: config.ETH_REGISTRY,
        owner: owner && owner !== zeroAddress ? owner : null,
      });
    } catch (e) {
      return c.json({ error: explainRevert(e) }, 502);
    }
  });

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
  /**
   * References the candidate asked for, by `<candidate>:<voucher>`. Anyone may write a reference, so
   * this records which ones were invited — with the invitation itself, so the claim is checkable by
   * whoever reads it rather than trusted because this service says so.
   */
  /*
   * Demo switches an admin flips at run time. One so far: whether a reference needs the Selfie Check.
   * Off, the gate stands down for everyone and the browser stops asking; the configured default is
   * what the switch returns to.
   */
  const switches = new PersistentMap<boolean>(
    "switches",
    config.DATA_DIR || undefined,
    (raw) => raw === true,
    (value) => value
  );
  const selfieCheckRequired = () => config.VOUCH_REQUIRES_HUMANITY && switches.get("selfieCheck") !== false;
  const selfieCheckOffered = () => !!worldFrom(config) && switches.get("selfieCheck") !== false;

  const solicitedStore = new PersistentMap<{ handle: string; voucher: Address; exp: string; signature: Hex }>(
    "solicited",
    config.DATA_DIR || undefined,
    (raw) => raw as { handle: string; voucher: Address; exp: string; signature: Hex },
    (value) => value
  );

  async function rememberSolicited(req: AttestRequest): Promise<void> {
    const candidate = candidateOf(req.intent.domain, [config.VOUCH_PREFIX]);
    if (!candidate || !req.invite) return;
    const onchain = await readFor(req);
    const key = `${candidate}:${req.intent.handle}`;
    if (!(await solicitedBy(req, onchain, await env()))) {
      /*
       * A claim that failed takes the mark with it.
       *
       * The mark is stored per candidate and writer, and a reference can be superseded: one written
       * under a good invitation and then rewritten under an invitation that does not qualify kept
       * saying the candidate asked for it, because nothing ever removed what an earlier request put
       * there. A presented invitation is a claim about the record being written now, so failing it
       * has to mean what it says.
       *
       * Presenting none is left alone: that is how a writer updates or withdraws what they already
       * wrote, and it says nothing about how the reference was asked for in the first place.
       */
      solicitedStore.delete(key);
      return;
    }
    solicitedStore.set(key, {
      handle: req.invite.handle,
      voucher: req.invite.voucher,
      exp: req.invite.exp.toString(),
      signature: req.invite.signature,
    });
  }

  /**
   * The letter held for a hash, if what is held is that letter.
   *
   * The store is content-addressed, so the text under a key hashes to it — at the moment it is
   * written. Nothing re-checked it afterwards, and the store is a file this service can rewrite. The
   * card tells a reader the letter checks against the hash on the record, and that is only true if
   * somebody checks: this is the one thing this service hands over that the chain does not hold, so
   * it is the one thing a reader cannot check for themselves without it.
   */
  function heldLetter(hash: string): string | undefined {
    const held = letterStore.get(hash);
    if (held === undefined) return undefined;
    if (createHash("sha256").update(held).digest("hex") === hash) return held;
    console.error(`letter · the copy held for ${hash} does not hash to it; refusing to serve it`);
    return undefined;
  }

  /** Split a `description` into the letter a reader sees and the hash that proves it, if there is one. */
  function letterOf(text: string): { letter: string | null; letterHash: string | null } {
    const ref = /^sha256:([0-9a-f]{64})$/.exec(text.trim());
    if (!ref) return { letter: text || null, letterHash: null };
    return { letter: heldLetter(ref[1]) ?? null, letterHash: ref[1] };
  }

  /**
   * An invitation behind a short code.
   *
   * The invitation is a signature over what the candidate asked for, and base64 makes a link nobody
   * can paste into a message without it wrapping. The code is only a shortcut: what comes back is the
   * signed invitation itself, checked the same way whether it arrived by code or in full.
   */
  /** The invitation as it travels: `exp` is a decimal string, which is what a stored JSON holds. */
  type WireInvite = Omit<SignedInvite, "exp"> & { exp: string };
  /**
   * The other kind of invitation, kept in the same place under the same codes.
   *
   * A candidate's invitation asks somebody to write for them. An employer's asks somebody with no page
   * yet to make one and be read against a bar — "peersky is inviting you to pass their policy; begin by
   * connecting your github.com account". It names the person by the account the employer knows them
   * by, and is signed by the wallet holding the employer's name, so "X is inviting you" is X's own
   * claim. One store, one code shape, one link shape: `?invite=<code>` on the page the person lands on.
   */
  type WirePolicyInvite = Omit<SignedPolicyInvite, "exp"> & { kind: "policy"; exp: string };
  type Kept = WireInvite | WirePolicyInvite;
  const isPolicy = (i: Kept): i is WirePolicyInvite => (i as WirePolicyInvite).kind === "policy";
  const inviteStore = new PersistentMap<Kept>(
    "invites",
    config.DATA_DIR || undefined,
    (raw) => raw as Kept,
    (invite) => invite
  );
  const wirePolicyInvite = z.object({
    kind: z.literal("policy"),
    inviter: z.string().regex(HANDLE_RE),
    platform: z.string().min(3).max(253),
    account: z.string().min(1).max(64),
    policy: z.string().max(2000),
    exp: z.string().regex(/^\d+$/),
    signature: hex,
  });

  /** Whether the account the employer named has a page yet: the person, once they came. */
  async function holderOf(
    platform: string,
    account: string
  ): Promise<{ wallet: Address; candidate: string | null } | null> {
    const match = (await chain.listRecords(platform)).find(
      (r) => r.live && r.name.toLowerCase() === account.toLowerCase()
    );
    if (!match) return null;
    const held = await chain.listRecordsByWallet(match.wallet);
    return {
      wallet: match.wallet,
      candidate: held.find((r) => r.live && config.NAME_DOMAINS.includes(r.domain))?.name ?? null,
    };
  }

  /** An employer's invitation as the routes answer it: who asks, the bar, and how far the person came. */
  const policyInviteView = async (code: string, i: WirePolicyInvite) => {
    const rootParent = (await chain.instances()).find((x) => x.domain === config.NAME_DOMAINS[0])?.parentName;
    const holder = await holderOf(i.platform, i.account);
    return {
      code,
      kind: "policy" as const,
      inviter: i.inviter,
      inviterName: rootParent ? `${i.inviter}.${rootParent}` : i.inviter,
      platform: i.platform,
      account: i.account,
      policy: i.policy,
      expiresAt: new Date(Number(i.exp) * 1000).toISOString(),
      expired: Number(i.exp) <= now(),
      // Where they are on the way: not yet here, account linked, or a page to read against the bar.
      status: holder?.candidate ? "claimed" : holder ? "linked" : "invited",
      candidate: holder?.candidate ?? null,
    };
  };

  /** The employer's kind: signed by the wallet holding the inviter's name, naming an attested platform. */
  async function keepPolicyInvite(c: Context, raw: unknown) {
    const body = wirePolicyInvite.safeParse(raw);
    if (!body.success) return c.json({ error: "bad request", issues: body.error.issues }, 400);
    const invite: WirePolicyInvite = {
      kind: "policy",
      inviter: body.data.inviter.toLowerCase(),
      platform: body.data.platform.toLowerCase(),
      account: body.data.account.trim().replace(/^@/, "").toLowerCase(),
      policy: body.data.policy,
      exp: body.data.exp,
      signature: body.data.signature as Hex,
    };
    if (Number(invite.exp) <= now())
      return c.json({ error: "an invitation must not have expired already" }, 400);
    // The person is named by an account somewhere this deployment attests — or, where they already
    // hold a page, by their handle in the root name domain; anywhere else it is a string.
    const platforms = (await chain.instances()).map((i) => i.domain).filter((d) => d.includes("."));
    if (!platforms.includes(invite.platform) && invite.platform !== config.NAME_DOMAINS[0]) {
      return c.json({ error: `this deployment does not attest ${invite.platform} accounts` }, 400);
    }
    const signer = await recoverPolicyInviteSigner(
      {
        inviter: invite.inviter,
        platform: invite.platform,
        account: invite.account,
        policy: invite.policy,
        exp: BigInt(invite.exp),
      },
      invite.signature,
      policyInviteDomain(config.CHAIN_ID, config.MULTIPASS)
    ).catch(() => undefined);
    const status = await chain.nameStatus(config.NAME_DOMAINS[0] ?? "", invite.inviter);
    if (!signer || !status.live || signer.toLowerCase() !== (status.wallet ?? "").toLowerCase()) {
      return c.json({ error: "an invitation must be signed by the wallet holding the inviter's name" }, 400);
    }
    const code = createHash("sha256").update(invite.signature).digest("hex").slice(0, 32);
    inviteStore.set(code, invite);
    return c.json({ code });
  }

  app.post("/v1/invite", async (c) => {
    const raw = await c.req.json().catch(() => null);
    if (raw && typeof raw === "object" && (raw as { kind?: unknown }).kind === "policy") {
      return keepPolicyInvite(c, raw);
    }
    const body = wireInvite.safeParse(raw);
    if (!body.success) return c.json({ error: "bad request", issues: body.error.issues }, 400);
    const invite = {
      handle: body.data.handle.toLowerCase(),
      voucher: body.data.voucher as Address,
      exp: body.data.exp,
      requires: body.data.requires.map((d) => d.toLowerCase()),
      signature: body.data.signature as Hex,
    };
    // Only the candidate can invite on their own behalf; a code that stood for anything else would be
    // a link this service made up.
    const signer = await recoverInviteSigner(
      { handle: invite.handle, voucher: invite.voucher, exp: BigInt(invite.exp), requires: invite.requires },
      invite.signature,
      inviteDomain(config.CHAIN_ID, config.MULTIPASS)
    ).catch(() => undefined);
    const status = await chain.nameStatus(config.NAME_DOMAINS[0] ?? "", invite.handle);
    if (!signer || !status.live || signer.toLowerCase() !== (status.wallet ?? "").toLowerCase()) {
      return c.json({ error: "an invitation must be signed by the wallet holding that name" }, 400);
    }
    /*
     * Addressed by its own signature, so the same invitation is always the same code.
     *
     * Thirty-two characters of it, not eight. An invitation is what makes a reference count as one the
     * candidate asked for — the thing a verifier's "only references they asked for" bar rests on — and
     * it is handed out over an open endpoint. At eight hex the whole space is 2^32, so that bar was
     * defeatable by guessing rather than by being invited.
     */
    const code = createHash("sha256").update(invite.signature).digest("hex").slice(0, 32);
    inviteStore.set(code, invite);
    return c.json({ code });
  });

  /**
   * The invitations a candidate has made and can still hand out.
   *
   * The link used to live in the page's own state, so closing the tab lost it and the candidate had to
   * sign another. An expired one is left out: its link no longer works, and showing it would be an
   * offer nobody can take.
   */
  app.get("/v1/invites/:handle", async (c) => {
    const handle = c.req.param("handle").toLowerCase();
    const mine = inviteStore.entries();
    /*
     * Which invitations were used, and by whom.
     *
     * A reference written with an invitation is remembered as solicited, with the invitation's own
     * signature — and the code is that signature's hash, so the two join without storing anything
     * more. The candidate's list then says "used by bob" beside the link, with the reference to open,
     * instead of offering the same link again as if nothing had happened. An invitation that was used
     * stays listed after it expires: what came of it is the point.
     */
    const usedBy = new Map<string, string[]>();
    for (const [key, s] of solicitedStore.entries()) {
      const [candidate, voucher] = key.split(":");
      if (candidate !== handle || !voucher) continue;
      const code = createHash("sha256").update(s.signature).digest("hex").slice(0, 32);
      usedBy.set(code, [...(usedBy.get(code) ?? []), voucher]);
    }
    const rootParent = (await chain.instances()).find((i) => i.domain === config.NAME_DOMAINS[0])?.parentName;
    const invites = mine
      .filter(
        (e): e is [string, WireInvite] =>
          !isPolicy(e[1]) && e[1].handle === handle && (Number(e[1].exp) > now() || usedBy.has(e[0]))
      )
      .map(([code, i]) => ({
        code,
        kind: "vouch" as const,
        requires: i.requires,
        expiresAt: new Date(Number(i.exp) * 1000).toISOString(),
        expired: Number(i.exp) <= now(),
        // Who wrote with it, and the name each reference answers at, to open it.
        usedBy: (usedBy.get(code) ?? []).map((voucher) => ({
          voucher,
          ensName: rootParent ? `${voucher}.${handle}.${rootParent}` : null,
        })),
      }))
      .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));
    // Everyone this name invited to be read against a bar, expired ones included: "never came" is an answer.
    const asked = await Promise.all(
      mine
        .filter((e): e is [string, WirePolicyInvite] => isPolicy(e[1]) && e[1].inviter === handle)
        .map(([code, i]) => policyInviteView(code, i))
    );
    return c.json({ handle, invites, asked: asked.sort((a, b) => a.expiresAt.localeCompare(b.expiresAt)) });
  });

  app.get("/v1/invite/:code", async (c) => {
    const code = c.req.param("code").toLowerCase();
    const invite = /^[0-9a-f]{32}$/.test(code) ? inviteStore.get(code) : undefined;
    if (!invite) return c.json({ error: "no invitation with that code" }, 404);
    if (isPolicy(invite)) return c.json({ ...(await policyInviteView(code, invite)), warning: WARNING });
    return c.json({ code, kind: "vouch", invite });
  });

  /**
   * A letter too long to sit on chain.
   *
   * A name holds 31 bytes and a text record costs gas by the byte, so a full reference cannot live
   * there. The letter is kept here and addressed by the hash of its own text; what goes on the
   * reference is `sha256:<hash>`, which is what makes the copy checkable instead of trusted — anyone
   * can hash what they were handed and compare it with the record.
   *
   * The trade is honest and worth stating: the hash is permanent, the text is only as durable as this
   * service's storage. A lost letter can be proven to have said what it said, not recovered.
   */
  const LETTER_MAX_BYTES = 20_000;
  const letterStore = new PersistentMap<string>(
    "letters",
    config.DATA_DIR || undefined,
    (raw) => raw as string,
    (text) => text
  );
  const letterBytes = () =>
    letterStore.entries().reduce((n, [, text]) => n + new TextEncoder().encode(text).length, 0);

  app.post("/v1/letter", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { text?: unknown } | null;
    const text = typeof body?.text === "string" ? body.text : "";
    if (!text.trim()) return c.json({ error: "a letter needs something in it" }, 400);
    const size = new TextEncoder().encode(text).length;
    if (size > LETTER_MAX_BYTES) {
      return c.json({ error: `a letter must be under ${LETTER_MAX_BYTES / 1000}kB` }, 413);
    }
    const hash = createHash("sha256").update(text).digest("hex");
    // Already held: content-addressed, so writing the same letter twice costs nothing and is not
    // refused for space it does not need.
    if (letterStore.get(hash) === undefined && letterBytes() + size > config.LETTER_STORE_BYTES) {
      return c.json(
        { error: "the letter store is full; ask the operator to raise LETTER_STORE_BYTES or free space" },
        507
      );
    }
    letterStore.set(hash, text);
    return c.json({ hash, ref: `sha256:${hash}`, bytes: size });
  });

  app.get("/v1/letter/:hash", (c) => {
    const hash = c.req.param("hash").toLowerCase();
    const text = /^[0-9a-f]{64}$/.test(hash) ? heldLetter(hash) : undefined;
    if (text === undefined) return c.json({ error: "no letter with that hash" }, 404);
    return c.json({ hash, text });
  });

  /**
   * What people said under one instance name.
   *
   * `kju-is.<root>` is not an unclaimed person: it is where answers about one are published, and a
   * page reporting "no record" there hides every answer anyone wrote. The purpose is read from the
   * name's own description record, so it travels with the answers rather than living in this app.
   */
  app.get("/v1/instance/:domain", async (c) => {
    const domain = c.req.param("domain").toLowerCase();
    const instance = (await chain.instances()).find((i) => i.domain === domain);
    if (!instance) return c.json({ error: `no instance called "${domain}" here` }, 404);

    // Who the page is about, read from the name itself: a page for someone who has claimed nothing is
    // only worth reading if it says who they are, and that belongs on chain rather than in this app.
    // `name` is the standard display-name text record: a page titled `kju-is.<root>` says what the
    // name is, not who it is about.
    const keys = ["name", "description", "url", "avatar"] as const;
    /*
     * Read through the registry, not through the instance's own resolver.
     *
     * `instance.resolver` answers for the names *under* this mount — `alice.kju-is.<root>` — and the
     * page is about the mount itself, whose texts live on whichever resolver the registry points at for
     * that label. Asking the instance produced an empty record for a name that resolves perfectly well
     * in any ENS client, which is the one place this app must not disagree with one.
     */
    const [records, about] = await Promise.all([
      chain.listRecords(domain),
      chain
        .resolveUniversal(instance.parentName, [...keys])
        .then((r) => r.texts)
        .catch(async () => {
          /*
           * No universal resolver configured: fall back to the mount's own, which answers for a
           * deployment whose instance holds its own texts.
           *
           * A key that cannot be read is not a key with nothing in it. Where every one of them fails
           * the fallback resolver is not answering either, and an empty record would reach the page as
           * "nobody has said who this is about" — a claim about a subject, made from no reading of it.
           */
          const texts = await Promise.all(
            keys.map((key) =>
              chain
                .resolveText(instance.resolver, instance.parentName, key)
                .then((v) => ({ ok: true as const, v }))
                .catch((e: Error) => ({ ok: false as const, e }))
            )
          );
          const failure = texts.find((t) => !t.ok);
          if (texts.every((t) => !t.ok)) {
            throw failure && !failure.ok ? failure.e : new Error("this instance could not be read");
          }
          return Object.fromEntries(keys.map((key, i) => [key, texts[i].ok ? texts[i].v : ""])) as Record<
            string,
            string
          >;
        }),
    ]);
    const description = about.description ?? "";
    /*
     * The newest first, and a page of them.
     *
     * This is the one list the product invites the whole world to add to, and it was returned entire:
     * a question everybody answers eventually answers back with every answer ever given, to a page
     * that then renders all of them. Newest first because an answer is a thing somebody said at a
     * time, and `total` beside it because a list that stops must say that it did.
     */
    const live = records.filter((r) => r.live).sort((a, b) => Number(b.validUntil) - Number(a.validUntil));
    return c.json({
      domain,
      parentName: instance.parentName,
      description: description || null,
      records: about,
      total: live.length,
      answers: live.slice(0, ANSWER_PAGE).map((r) => ({
        handle: r.name,
        ensName: `${r.name}.${instance.parentName}`,
        answer: fromBytes32(r.payload),
        wallet: r.wallet,
        validUntil: new Date(Number(r.validUntil) * 1000).toISOString(),
      })),
      warning: WARNING,
    });
  });

  /**
   * Who holds a platform account here. The first step of referring someone: you know them as `@bob` on
   * x.com, and this says whether that account already belongs to a page rather than making you guess a
   * handle for a person who already has one.
   *
   * Only accounts attested in the open can be found. A masked record stores a one-time pad over the
   * handle, so no search can match it — and reporting that as "nobody" would invite writing a second
   * page for someone who already has one. It is said plainly instead.
   */
  /**
   * People whose handle looks like what was typed, most-referenced first.
   *
   * Two people can be called `bob`, and nothing on chain decides which one anybody means. The one
   * people have actually written references for is the one they mean, and that answer gets truer over
   * time rather than being settled up front by whoever registered first. So this ranks rather than
   * picks, and the person referring makes the call with the evidence in front of them.
   */
  /*
   * A view code, out of a header rather than a query string.
   *
   * It is the one-time pad that unmasks an account on chain: permanent, unrevocable, and the whole
   * secret. In a query string it lands in this service's access log, in the web server's, in every
   * proxy between them, and in the browser's history — where a secret that never expires cannot be
   * taken back. A header is sent to exactly one place and logged by none of them by default.
   */
  const viewCodeOf = (c: { req: { header: (name: string) => string | undefined } }): string | undefined =>
    c.req.header("x-view-code");

  /**
   * The reference graph, read from every vouch domain this deployment holds.
   *
   * A count is not a shape: three references from strangers and three from a ring that only refers
   * each other are the same number, and the difference is what a verifier wants. Every edge here is a
   * signed record anybody can resolve; nothing is inferred.
   */
  async function wholeGraph(): Promise<{
    graph: ReferenceGraph;
    human: Set<string>;
    rank: Map<string, number>;
    score: Map<string, number>;
  }> {
    const instances = await chain.instances();
    const domains = instances.map((i) => i.domain).filter((d) => d.startsWith(config.VOUCH_PREFIX));
    const rootDomain = config.NAME_DOMAINS[0] ?? "";
    const [records, held, proofs] = await Promise.all([
      Promise.all(
        domains.map(async (domain) =>
          (await chain.listRecords(domain)).map((r) => ({ domain, name: r.name, live: r.live }))
        )
      ).then((all) => all.flat()),
      chain.listRecords(rootDomain),
      // Who has proved humanity: a live record in the humanity domain, keyed by wallet.
      config.HUMANITY_DOMAIN ? chain.listRecords(config.HUMANITY_DOMAIN) : Promise.resolve([]),
    ]);
    const graph = referenceGraph(records, config.VOUCH_PREFIX);
    /*
     * Seeds are people, and a proof is on a wallet: join through the name each wallet holds. Only a
     * live proof counts, and only a live name — a lapsed name is not somebody trust should start from.
     */
    const provedWallets = new Set(proofs.filter((r) => r.live).map((r) => r.wallet.toLowerCase()));
    const human = new Set(
      held.filter((r) => r.live && provedWallets.has(r.wallet.toLowerCase())).map((r) => r.name.toLowerCase())
    );
    return { graph, human, rank: sybilRank(graph, human), score: sybilScore(graph, human) };
  }

  /** A node as the routes answer it: the counts, whether they proved humanity, and their rank. */
  const describe = (
    g: ReferenceGraph,
    human: Set<string>,
    rank: Map<string, number>,
    score: Map<string, number>
  ) =>
    g.nodes.map((n) => ({
      ...n,
      human: human.has(n.handle),
      // Four places: enough to compare, not enough to read as precision this signal does not have.
      rank: Number((rank.get(n.handle) ?? 0).toFixed(4)),
      // What accumulated behind them, 0–100: the number a page leads with.
      score: score.get(n.handle) ?? 0,
    }));

  app.get("/v1/graph", async (c) => {
    const { graph, human, rank, score } = await wholeGraph();
    return c.json({
      nodes: describe(graph, human, rank, score),
      edges: graph.edges,
      seeds: human.size,
      warning: WARNING,
    });
  });

  app.get("/v1/graph/:handle", async (c) => {
    const handle = c.req.param("handle").toLowerCase();
    if (!HANDLE_RE.test(handle)) return c.json({ error: "bad handle" }, 400);
    const { graph, human, rank, score } = await wholeGraph();
    const near = neighbourhood(graph, handle);
    return c.json({
      handle,
      nodes: describe(near, human, rank, score),
      score: score.get(handle) ?? 0,
      edges: near.edges,
      // Measured on the whole graph: a cluster does not stop at the edge of what is drawn.
      metrics: personMetrics(graph, handle),
      rank: Number((rank.get(handle) ?? 0).toFixed(4)),
      human: human.has(handle),
      seeds: human.size,
      warning: WARNING,
    });
  });

  /**
   * How their references read.
   *
   * A count of references and the shape behind them still say nothing about what the references say,
   * and "would hire again" is one reference exactly as "do not lend them money" is. The reading comes
   * from the Noolog fast council (spec §E.8) — a provisional classification of each statement's text,
   * kept by its hash — and is shown as what it is: how three models read thirty-one bytes, superseded
   * when peers have judged. Where no council is configured the statements are listed unread. Nothing
   * here scores a person; it reads sentences, and says which.
   */
  const readings = new Readings(
    councilFrom(config),
    new PersistentMap<Reading>(
      "readings",
      config.DATA_DIR || undefined,
      (raw) => raw as Reading,
      (r) => r
    ),
    fetchImpl
  );
  /** How many statements one request will send to the council; a page nobody reads is money spent. */
  const READ_PAGE = 40;

  app.get("/v1/readings/:handle", async (c) => {
    const handle = c.req.param("handle").toLowerCase();
    if (!HANDLE_RE.test(handle)) return c.json({ error: "bad handle" }, 400);
    const said = (r: { payload: Hex }) => readable(fromBytes32(r.payload));
    // A withdrawn reference is a live record and not a reference; a masked payload is not words.
    const spoken = (r: { live: boolean; payload: Hex }) =>
      r.live && said(r) !== undefined && said(r) !== WITHDRAWN;
    const rootDomain = config.NAME_DOMAINS[0] ?? "";
    const [about, status] = await Promise.all([
      chain.listRecords(`${config.VOUCH_PREFIX}${handle}`),
      chain.nameStatus(rootDomain, handle),
    ]);
    const wrote =
      status.live && status.wallet
        ? (await chain.listRecordsByWallet(status.wallet)).filter((r) => isVouchDomain(r.domain))
        : [];
    const receivedSaid = about.filter(spoken).slice(0, READ_PAGE);
    const givenSaid = wrote.filter(spoken).slice(0, READ_PAGE);
    const [receivedRead, givenRead] = await Promise.all([
      Promise.all(receivedSaid.map((r) => readings.read(said(r) as string))),
      Promise.all(givenSaid.map((r) => readings.read(said(r) as string))),
    ]);
    return c.json({
      handle,
      council: readings.configured,
      model: readings.model,
      received: receivedSaid.map((r, i) => ({ voucher: r.name, says: said(r), reading: receivedRead[i] })),
      given: givenSaid.map((r, i) => ({
        candidate: r.domain.slice(config.VOUCH_PREFIX.length),
        says: said(r),
        reading: givenRead[i],
      })),
      summary: { received: summarise(receivedRead), given: summarise(givenRead) },
      warning: WARNING,
    });
  });

  /** How many answers one read of a subject carries; the rest are counted, not sent. */
  const ANSWER_PAGE = 50;

  app.get("/v1/find", async (c) => {
    const q = c.req.query("q")?.trim().toLowerCase().replace(/^@/, "") ?? "";
    // One character narrows almost nothing and costs a standing read per name it does not narrow.
    if (q.length === 1) return c.json({ error: "search for at least two characters" }, 400);

    const rootDomain = config.NAME_DOMAINS[0] ?? "";
    const live = (await chain.listRecords(rootDomain)).filter((r) => r.live);
    const hits = live.filter((r) => r.name.toLowerCase().includes(q));
    const matches = await Promise.all(
      hits.map(async (r) => {
        const s = await standing(r.name);
        return { handle: r.name, wallet: r.wallet, ...s };
      })
    );
    /*
     * Most references first; a tie falls back to the shorter name, which is the plainer one.
     *
     * Ranked before the list is cut, not after: cutting first ranked whichever ten happened to be
     * written earliest, so the person people had actually vouched for could fall outside the window
     * that was then sorted. With no query at all this is the whole namespace in that order, which is
     * what the front page asks for.
     */
    matches.sort((a, b) => b.received - a.received || a.handle.length - b.handle.length);
    /*
     * How many there were, beside the ten that came back.
     *
     * A reader searching a common name saw ten and no sign there were more, which reads as "these are
     * the people called that" — the opposite of what a list ranked by references is for, since the
     * eleventh is the one nobody has vouched for and the reader cannot tell they exist.
     */
    return c.json({ q, matches: matches.slice(0, 10), total: matches.length, warning: WARNING });
  });

  app.get("/v1/who", async (c) => {
    const domain = c.req.query("domain");
    const handle = c.req.query("handle")?.trim().replace(/^@/, "");
    if (!domain || !handle) return c.json({ error: "domain and handle required" }, 400);
    const viewCode = viewCodeOf(c);
    if (viewCode !== undefined && !/^0x[0-9a-fA-F]{64}$/.test(viewCode)) {
      return c.json({ error: "viewCode must be 32 bytes of hex" }, 400);
    }

    const records = await chain.listRecords(domain);
    const live = records.filter((r) => r.live);
    // A view code is 32 bytes the candidate handed over, so holding it is the permission. With it the
    // masked name is computed and matched exactly; without it a private account cannot be found at all.
    const match = viewCode
      ? live.find((r) => r.rawName === maskName(storable(handle), viewCode as Hex))
      : live.find((r) => r.name.toLowerCase() === handle.toLowerCase());
    if (!match) {
      // A masked record carries a view-code commitment where a public one carries nothing; the name
      // itself is a pad and cannot be re-encoded, let alone matched.
      const masked = live.some((r) => r.payload !== zeroHash);
      return c.json({
        found: false,
        domain,
        handle: handle.toLowerCase(),
        warning: WARNING,
        ...(masked
          ? {
              note: "someone here attested a private account on this platform, and a private account cannot be searched — ask them for their page rather than starting a new one",
            }
          : {}),
      });
    }

    // The account is held by a wallet; the page is whatever that wallet is called in a name domain.
    const held = await chain.listRecordsByWallet(match.wallet);
    const candidate = held.find((r) => r.live && config.NAME_DOMAINS.includes(r.domain))?.name;
    return c.json({
      found: true,
      domain,
      handle: handle.toLowerCase(),
      wallet: match.wallet,
      candidate: candidate ?? null,
      // How many references they hold, so the same evidence is on screen here as in a name search.
      standing: candidate ? await standing(candidate) : null,
      warning: WARNING,
    });
  });

  app.post("/v1/attest", async (c) => {
    if (!config.REGISTRAR_KEY || !config.VIEWCODE_KEY) return c.json({ error: "registrar disabled" }, 501);
    const parsed = wireRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "bad request", issues: parsed.error.issues }, 400);
    const req = toRequest(parsed.data);
    // Refuse before signing: a domain this attester cannot write produces a revert later, and the
    // signature the user already gave is wasted either way.
    const blocker = await writeBlocker(req.intent.domain);
    if (blocker) return c.json({ error: blocker }, 503);
    const notHuman = await humanityGate(req.intent.wallet, req.intent.domain);
    if (notHuman) return c.json({ error: notHuman }, 403);
    const domain = req.intent.domain;
    const plan = await namespacePlan(domain);
    let result;
    try {
      const onchain = await readFor(req);
      const base = await env();
      result = await attest(
        req,
        onchain,
        { registrarKey: config.REGISTRAR_KEY, viewcodeKey: config.VIEWCODE_KEY },
        // A domain about to be provisioned is one this deployment will hold in a moment. The attester
        // still has to agree the account belongs to it, which is what makes the spend safe.
        plan.write ? { ...base, platformDomains: [...(base.platformDomains ?? []), domain] } : base
      );
    } catch (e) {
      return c.json({ error: (e as Error).message }, 422);
    }
    // Whether the candidate asked for this reference: a fact about it, kept so the card can say so.
    // The invitation is kept with it, so a reader can check the signature rather than take our word.
    await rememberSolicited(req);
    // Only now, with the account proven: the signature is worthless until the domain exists on chain.
    if (plan.mount) {
      try {
        await chain.ensureNamespace(domain);
      } catch (e) {
        return c.json({ error: `could not mount "${domain}": ${explainRevert(e)}` }, 503);
      }
    }
    return c.json(serialize(result));
  });

  /**
   * Write a registrar-signed record, and arrange what has to exist around it.
   *
   * Both delivery routes go through here on purpose. They accept the same record and differ only in
   * who is allowed to call them, so anything one of them arranges the other must arrange too: when
   * they drifted, a statement written through the enclave reverted for a candidate who had claimed
   * nothing, and a name claimed from a browser never got the instance others write references into.
   */
  /**
   * A reference is written by one real person, or not written.
   *
   * Not a policy a verifier sets and not a choice a candidate makes when asking: it is what a
   * reference here means. The writer's wallet must hold a live humanity proof before a statement in a
   * candidate's vouch domain is signed or relayed. Only the vouch domains: claiming a name and linking
   * an account are the writer's own business.
   */
  async function humanityGate(wallet: Address, domain: string): Promise<string | null> {
    if (!selfieCheckRequired() || !isVouchDomain(domain)) return null;
    const proof = await chain.recordFor(wallet, config.HUMANITY_DOMAIN);
    if (proof?.live) return null;
    return "a reference is written by one real person: pass the Selfie Check on your profile first";
  }

  async function deliver(record: RegisterMessage, signature: Hex) {
    // The candidate's vouch domain has to exist before a statement can be written into it.
    await ensureVouchDomain(record);
    const txHash = await chain.submit(record, signature);
    // A newly claimed root name gets its own vouch instance, so others can refer that person.
    let vouchInstance: { domain: string; created: boolean } | undefined;
    if (config.NAME_DOMAINS[0] && fromBytes32(record.domainName) === config.NAME_DOMAINS[0]) {
      try {
        vouchInstance = await chain.ensureVouchInstance(fromBytes32(record.name));
      } catch (e) {
        // The record is written either way; the instance is arranged again on the first reference.
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
    return { ok: true as const, txHash, ...(vouchInstance ? { vouchInstance } : {}) };
  }

  /**
   * Submit a registrar-signed record from a browser. No secret: the record is only accepted because
   * the registrar signed it, so relaying someone else's signed record writes exactly what they asked
   * for and nothing more. The token-gated route below is the enclave's.
   */
  app.post("/v1/submit", async (c) => {
    const parsed = wireDelivery.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ ok: false, error: "bad request", issues: parsed.error.issues }, 400);
    const record = toRecord(parsed.data.record);
    const notHuman = await humanityGate(record.wallet, fromBytes32(record.domainName));
    if (notHuman) return c.json({ ok: false, error: notHuman }, 403);
    try {
      return c.json(await deliver(record, parsed.data.signature as Hex));
    } catch (e) {
      return c.json({ ok: false, error: (e as Error).message }, 502);
    }
  });

  /** CRE external delivery: the same write, gated on the delivery token. */
  app.post("/v1/cre/delivery", async (c) => {
    if (config.DELIVERY_TOKEN && c.req.header("x-delivery-token") !== config.DELIVERY_TOKEN) {
      return c.json({ ok: false, error: "unauthorized" }, 401);
    }
    const parsed = wireDelivery.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ ok: false, error: "bad request", issues: parsed.error.issues }, 400);
    const record = toRecord(parsed.data.record);
    const notHuman = await humanityGate(record.wallet, fromBytes32(record.domainName));
    if (notHuman) return c.json({ ok: false, error: notHuman }, 403);
    try {
      return c.json(await deliver(record, parsed.data.signature as Hex));
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
      // Anything that is not a grant this build understands — one written by an older format, say — is
      // refused here and dropped by the store. Reviving it anyway put an unusable row in the list and
      // took every other share down with it.
      const g = raw as Omit<SignedDisclosure, "exp"> & { exp: string };
      if (!Array.isArray(g?.domains) || !Array.isArray(g?.boxes) || typeof g?.boxesHash !== "string") {
        throw new Error("disclosure: not a grant this build can read");
      }
      return { ...g, audienceName: g.audienceName ?? "", exp: BigInt(g.exp) };
    },
    (grant) => ({ ...grant, exp: grant.exp.toString() })
  );
  /*
   * What opens a grant made for "whoever holds the link".
   *
   * Such a grant binds nobody, so the link is the whole permission — and it was
   * `/v/<their public name>?reveal=<the account>`, both halves of which anybody can guess, which made
   * every account shared that way readable by the world rather than by the person it was sent to.
   *
   * Kept beside the grant rather than inside it, and only ever the hash: `/v1/disclosures/:name` is
   * the holder's own list of who can read what, and must not itself hand out the permissions it lists.
   */
  const linkKeyStore = new PersistentMap<string>(
    "linkkeys",
    config.DATA_DIR || undefined,
    (raw) => raw as string,
    (h) => h
  );
  app.post("/v1/disclose", async (c) => {
    const body = wireDisclosure.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "bad request", issues: body.error.issues }, 400);
    const grant: SignedDisclosure = {
      name: body.data.name.toLowerCase(),
      domains: body.data.domains,
      audience: body.data.audience as Address,
      audienceName: body.data.audienceName.toLowerCase(),
      exp: BigInt(body.data.exp),
      boxesHash: body.data.boxesHash as Hex,
      boxes: body.data.boxes.map((b) => ({
        ephemeralPubkey: b.ephemeralPubkey as Hex,
        nonce: b.nonce as Hex,
        ciphertext: b.ciphertext as Hex,
      })),
      signature: body.data.signature as Hex,
    };
    const located = locate(grant.name, await chain.instances());
    if (!located) return c.json({ error: "unknown instance for name" }, 404);
    const holder = await chain.resolveAddr(located.instance.resolver, grant.name);
    try {
      const signer = await recoverDiscloseSigner(
        {
          name: grant.name,
          domains: grant.domains,
          audience: grant.audience,
          audienceName: grant.audienceName,
          exp: grant.exp,
          boxesHash: grant.boxesHash,
        },
        grant.signature,
        discloseDomain(config.CHAIN_ID, config.MULTIPASS)
      );
      checkDisclosure(grant, { holder, now: now(), signer });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 422);
    }
    // One signature, one grant, one thing to take back. Storing it per account would make a share of
    // two accounts look like two permissions, and would let a second share of one account quietly
    // replace the first rather than standing beside it.
    const key = `${grant.name}:${grantId(grant)}`;
    grantStore.set(key, grant);
    /*
     * Set once. The grant is checked by its signature, but this is not signed — so a second POST of
     * the same grant must not be able to replace the secret that opens it with one the sender chose.
     */
    if (body.data.linkKeyHash && !linkKeyStore.get(key)) {
      linkKeyStore.set(key, body.data.linkKeyHash.toLowerCase());
    }
    return c.json({
      ok: true,
      id: grantId(grant),
      name: grant.name,
      domains: grant.domains,
      expiresAt: new Date(Number(grant.exp) * 1000).toISOString(),
    });
  });

  /**
   * What this name is currently sharing. A summary only — domain, reader and expiry — because the
   * question it answers is the holder's own: who can read my private accounts, and until when.
   * Expired grants are left out rather than shown dead, so the list is exactly what is live.
   */
  app.get("/v1/disclosures/:name", async (c) => {
    const name = c.req.param("name").toLowerCase();
    const grants = grantStore
      .entries()
      .filter(([, g]) => g.name === name && g.exp > BigInt(now()))
      .map(([, g]) => ({
        id: grantId(g),
        domains: g.domains,
        audience: g.audience,
        audienceName: g.audienceName,
        expiresAt: new Date(Number(g.exp) * 1000).toISOString(),
      }))
      .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt) || a.id.localeCompare(b.id));
    return c.json({ name, grants });
  });

  /**
   * Take one back. Signed by the same wallet that granted it and dated, so a captured revocation
   * cannot be replayed later to undo a share made since.
   */
  app.post("/v1/revoke", async (c) => {
    const body = wireRevocation.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "bad request", issues: body.error.issues }, 400);
    const revocation = {
      name: body.data.name.toLowerCase(),
      grantId: body.data.grantId as Hex,
      at: BigInt(body.data.at),
    };
    const key = `${revocation.name}:${revocation.grantId}`;
    const existing = grantStore.get(key);
    if (!existing) return c.json({ error: "no such grant" }, 404);
    const located = locate(revocation.name, await chain.instances());
    if (!located) return c.json({ error: "unknown instance for name" }, 404);
    const holder = await chain.resolveAddr(located.instance.resolver, revocation.name);
    try {
      const signer = await recoverRevokeSigner(
        revocation,
        body.data.signature as Hex,
        discloseDomain(config.CHAIN_ID, config.MULTIPASS)
      );
      checkRevocation(revocation, { holder, now: now(), signer });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 422);
    }
    grantStore.delete(key);
    return c.json({ ok: true, name: revocation.name, id: revocation.grantId, domains: existing.domains });
  });

  /**
   * The name a reader may be judged by. A grant can be addressed to a person or to a branch rather than
   * to a key, so the reader says which name they hold — and this resolves it, refusing anything that
   * does not answer with their own wallet. A claim is never evidence; the resolver is.
   */
  async function heldBy(
    claimed: string | undefined,
    reader: Address | undefined
  ): Promise<string | undefined> {
    if (!claimed || !reader) return undefined;
    const at = locate(claimed.toLowerCase(), await chain.instances());
    if (!at) return undefined;
    const owner = await chain.resolveAddr(at.instance.resolver, claimed.toLowerCase());
    return owner.toLowerCase() === reader.toLowerCase() ? claimed.toLowerCase() : undefined;
  }

  /**
   * Read a masked account the candidate allowed. The handle is never written anywhere: the enclave
   * opens the view code, decodes the record and answers this one question.
   */
  app.get("/v1/disclose/:name/:domain", async (c) => {
    if (!config.REGISTRAR_KEY) return c.json({ error: "registrar disabled" }, 501);
    const name = c.req.param("name").toLowerCase();
    const domain = c.req.param("domain");
    // One account can be shared with several people, each by its own grant. The reader is asking about
    // the account, so every grant that names it is a candidate and the first one that opens for them wins.
    const candidates = grantStore
      .entries()
      .filter(([, g]) => g.name === name && g.domains.includes(domain))
      .map(([, g]) => g);
    if (candidates.length === 0) return c.json({ error: "no disclosure for that account" }, 404);
    const reader = c.req.query("reader") as Address | undefined;
    const readerName = await heldBy(c.req.query("as"), reader);
    /*
     * The secret out of the link, for a grant that was made for whoever holds one.
     *
     * It arrives in the URL fragment and is put on this request by the browser, so it stays out of
     * server logs and out of a referrer header on the way here.
     */
    const offered = c.req.query("k");
    const offeredHash = offered && LINK_KEY_RE.test(offered) ? linkKeyHash(offered as Hex) : undefined;
    const located = locate(name, await chain.instances());
    if (!located) return c.json({ error: "unknown instance for name" }, 404);
    const holder = await chain.resolveAddr(located.instance.resolver, name);
    let grant: SignedDisclosure | undefined;
    let refusal = "disclosure: addressed to a different reader";
    for (const candidate of candidates) {
      try {
        const signer = await recoverDiscloseSigner(
          {
            name: candidate.name,
            domains: candidate.domains,
            audience: candidate.audience,
            audienceName: candidate.audienceName,
            exp: candidate.exp,
            boxesHash: candidate.boxesHash,
          },
          candidate.signature,
          discloseDomain(config.CHAIN_ID, config.MULTIPASS)
        );
        checkDisclosure(candidate, { holder, now: now(), signer });
        /*
         * A grant addressed to nobody is opened by the link, not by asking for it.
         *
         * `checkAudience` waves through anything whose audience is the zero address, which is what
         * "anyone with the link" is signed as — so with no secret required, the URL was guessable and
         * the account was not shared, it was published.
         */
        if (candidate.audience.toLowerCase() === zeroAddress && !candidate.audienceName) {
          const want = linkKeyStore.get(`${candidate.name}:${grantId(candidate)}`);
          if (!want) throw new Error("disclosure: this share predates link keys and must be made again");
          if (!offeredHash || offeredHash.toLowerCase() !== want) {
            throw new Error("disclosure: addressed to a different reader");
          }
        } else {
          checkAudience(candidate, { reader, readerName });
        }
        grant = candidate;
        break;
      } catch (e) {
        refusal = (e as Error).message;
      }
    }
    if (!grant) return c.json({ error: refusal }, 403);
    const packed = await chain.resolveData(located.instance.resolver, name, `ketsuban:link:${domain}`);
    if (packed === "0x" || packed.length !== 194) return c.json({ error: "no record for that account" }, 404);
    try {
      // The grant names its accounts in one order and carries their boxes in the same one: this
      // account's view code is the box at its own position, never simply the first.
      const box = grant.boxes[grant.domains.indexOf(domain)];
      if (!box) return c.json({ error: "no disclosure for that account" }, 404);
      const viewCode = bytesToHex(eciesDecrypt(config.REGISTRAR_KEY, box));
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
        label: z.string().regex(HANDLE_RE),
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
      const signature = await signRecord(record, config.REGISTRAR_KEY, await env());
      const txHash = await chain.submit(record, signature);
      return c.json({ ok: true, label, wallet, txHash, renewal: onchain.exists });
    } catch (e) {
      return c.json({ ok: false, error: (e as Error).message }, 502);
    }
  });

  /**
   * One human, one account.
   *
   * A World ID nullifier is stable for a person, this app and this action, so binding it to a wallet
   * is what makes the humanity record mean anything. The binding has to outlive a restart, or the same
   * person gets a second account with every redeploy — the failure `DATA_DIR` exists for.
   */
  const humans = new PersistentMap<Address>(
    "world-nullifiers",
    config.DATA_DIR || undefined,
    (raw) => {
      if (typeof raw !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(raw)) {
        throw new Error("humanity: not a wallet this build can read");
      }
      return raw as Address;
    },
    (wallet) => wallet
  );

  const walletBody = z.object({ wallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/) });

  /**
   * What the browser needs to ask World for a proof: the app to ask as, and a request signed with the
   * key that attributes it to this app. World refuses an unattributed request, and the key that
   * attributes it can never reach a browser — see https://docs.world.org/world-id/idkit/signatures.
   *
   * The signal is the wallet: it travels into the proof, and the write path refuses a proof bound to
   * anything else, so a proof captured in flight cannot be spent on another account.
   */
  app.post("/v1/humanity/challenge", async (c) => {
    if (!world) return c.json({ error: "World ID not configured" }, 501);
    const body = walletBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "wallet required" }, 400);
    const signed = await signRequest({
      signingKey: world.signingKey,
      action: world.action,
      createdAt: now(),
      random: randomBytes(32),
    });
    return c.json({
      app_id: world.appId,
      action: world.action,
      environment: world.environment,
      // Which credential to ask for. The browser is told rather than deciding: a widget that asked for
      // something this deployment will not accept sends people through a check for nothing.
      credential: world.credential,
      signal: body.data.wallet.toLowerCase(),
      rp_context: {
        rp_id: world.rpId,
        nonce: signed.nonce,
        created_at: signed.createdAt,
        expires_at: signed.expiresAt,
        signature: signed.sig,
      },
    });
  });

  /**
   * Verify a World ID proof and write the human into the humanity domain.
   *
   * The record is keyed by the wallet — an id derived from it, since Multipass keeps a record's id for
   * its whole life and the World nullifier is neither that stable nor something to publish — and it
   * carries the credential as its payload, which is what the instance resolver hops into to answer
   * `ketsuban:humanity` on a person's own name. That one human holds one account is the nullifier's
   * job, done off chain in `humans`: a second wallet presenting the same nullifier is refused before
   * anything is signed.
   */
  app.post("/v1/humanity", async (c) => {
    if (!world) return c.json({ error: "World ID not configured" }, 501);
    if (!config.REGISTRAR_KEY) return c.json({ error: "registrar disabled" }, 501);
    const body = walletBody
      .extend({ proof: z.record(z.unknown()) })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "wallet and proof required" }, 400);
    const wallet = getAddress(body.data.wallet);

    const blocker = await writeBlocker(config.HUMANITY_DOMAIN);
    if (blocker) return c.json({ error: blocker }, 503);

    let human;
    try {
      human = await verifyHumanProof(world, body.data.proof, wallet.toLowerCase(), fetchImpl);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 422);
    }

    const bound = humans.get(human.nullifier);
    if (bound && bound.toLowerCase() !== wallet.toLowerCase()) {
      return c.json({ error: "that proof of humanity is already held by another account" }, 409);
    }
    // Claimed before the write, so two requests in flight cannot both spend it. A write that fails
    // gives it back: a person whose transaction reverted must not be locked out of their own proof.
    humans.set(human.nullifier, wallet);

    // Everything after the claim is inside the try, including the chain read: it is a network call
    // like any other, and a claim released only on some of the ways this can fail is a claim that
    // still strands somebody on a wallet that never got a record.
    try {
      const onchain = await chain.readOnchain(wallet, config.HUMANITY_DOMAIN);
      const validUntil = BigInt(now() + config.RECORD_TERM_SECONDS);
      const record: RegisterMessage = {
        // A humanity record has no readable label: the resolver reaches it by wallet, never by name.
        name: zeroHash,
        id: humanityRecordId(wallet),
        domainName: toBytes32(config.HUMANITY_DOMAIN),
        validUntil,
        nonce: onchain.nonce + 1n,
        wallet,
        payload: toBytes32(human.level),
      };
      const signature = await signRecord(record, config.REGISTRAR_KEY, await env());
      let txHash: Hex;
      try {
        txHash = await chain.submit(record, signature);
      } catch (e) {
        // A deleted record — the admin reset, or the owner — keeps its nonce and resolves to nobody, so
        // no read can see it; the refusal names the number, and that is the one read that cannot lie.
        const named = (e as Error).message.match(/nonce must increase: on chain (\d+)/);
        if (!named) throw e;
        const retried = { ...record, nonce: BigInt(named[1]) + 1n };
        txHash = await chain.submit(retried, await signRecord(retried, config.REGISTRAR_KEY, await env()));
      }
      return c.json({
        ok: true,
        level: human.level,
        until: new Date(Number(validUntil) * 1000).toISOString(),
        nullifier: human.nullifier,
        txHash,
        renewal: onchain.exists,
      });
    } catch (e) {
      if (!bound) humans.delete(human.nullifier);
      return c.json({ ok: false, error: (e as Error).message }, 502);
    }
  });

  /**
   * Demo only: reset a Selfie Check on a named account.
   *
   * A demo needs to run the check again on the same person, and "one human, one account" is exactly
   * what stops that. This forgets every nullifier bound to the wallet and deletes its humanity record
   * on chain, an owner call the relayer can make here. Gated twice: a shared secret, and a registrar
   * that is this node — a deployment whose registrar is an enclave has no business undoing what it
   * wrote, and answers 501.
   */
  const adminGate = (c: Context): Response | null => {
    if (!config.ADMIN_TOKEN || !config.REGISTRAR_KEY) return c.json({ error: "admin disabled" }, 501);
    if (c.req.header("x-admin-token") !== config.ADMIN_TOKEN) return c.json({ error: "unauthorized" }, 401);
    return null;
  };
  /** The wallet an admin means: given outright, or held by the handle in the root name domain. */
  async function adminWallet(q: {
    wallet?: string;
    handle?: string;
  }): Promise<{ wallet: Address; handle: string | null } | null> {
    if (q.wallet && /^0x[0-9a-fA-F]{40}$/.test(q.wallet))
      return { wallet: getAddress(q.wallet), handle: q.handle ?? null };
    const handle = q.handle?.trim().toLowerCase();
    if (!handle || !HANDLE_RE.test(handle)) return null;
    const status = await chain.nameStatus(config.NAME_DOMAINS[0] ?? "", handle);
    return status.wallet ? { wallet: getAddress(status.wallet), handle } : null;
  }
  const humanityOf = async (wallet: Address) => {
    const onchain = await chain.readOnchain(wallet, config.HUMANITY_DOMAIN);
    const bound = humans.entries().filter(([, w]) => w.toLowerCase() === wallet.toLowerCase()).length;
    return { onchain: { exists: onchain.exists, nonce: onchain.nonce.toString() }, bound };
  };

  /** Demo only: whether a reference needs the Selfie Check right now, for everyone. */
  const selfieCheckState = () => ({
    required: selfieCheckRequired(),
    configured: config.VOUCH_REQUIRES_HUMANITY,
    offered: selfieCheckOffered(),
  });
  app.get("/v1/admin/selfie-check", (c) => {
    const refused = adminGate(c);
    if (refused) return refused;
    return c.json(selfieCheckState());
  });
  app.post("/v1/admin/selfie-check", async (c) => {
    const refused = adminGate(c);
    if (refused) return refused;
    const body = z.object({ required: z.boolean() }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "required: boolean" }, 400);
    switches.set("selfieCheck", body.data.required);
    return c.json(selfieCheckState());
  });

  app.get("/v1/admin/humanity", async (c) => {
    const refused = adminGate(c);
    if (refused) return refused;
    const who = await adminWallet({ wallet: c.req.query("wallet"), handle: c.req.query("handle") });
    if (!who) return c.json({ error: "no such account here" }, 404);
    return c.json({ ...who, ...(await humanityOf(who.wallet)) });
  });

  app.post("/v1/admin/humanity/reset", async (c) => {
    const refused = adminGate(c);
    if (refused) return refused;
    const body = z
      .object({ wallet: z.string().optional(), handle: z.string().optional() })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "wallet or handle required" }, 400);
    const who = await adminWallet(body.data);
    if (!who) return c.json({ error: "no such account here" }, 404);
    const before = await humanityOf(who.wallet);
    for (const [nullifier, w] of humans.entries()) {
      if (w.toLowerCase() === who.wallet.toLowerCase()) humans.delete(nullifier);
    }
    let deleted: { txHash: Hex } | { error: string } | null = null;
    if (before.onchain.exists) {
      try {
        deleted = { txHash: await chain.deleteRecord(config.HUMANITY_DOMAIN, who.wallet) };
      } catch (e) {
        deleted = { error: (e as Error).message };
      }
    }
    return c.json({ ...who, forgotten: before.bound, existed: before.onchain.exists, deleted });
  });

  /**
   * Provision a candidate's vouch instance. Idempotent, and open on purpose: it only acts for a
   * handle that already holds a live record in the root name domain, which the chain decides, so the
   * Chainlink log-trigger workflow can call it without a shared secret.
   */
  app.post("/v1/provision", async (c) => {
    const body = z
      // 31, as everywhere else: a name is a left-aligned bytes32 and that is the whole of it.
      .object({ handle: z.string().regex(HANDLE_RE) })
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
    if (!HANDLE_RE.test(handle)) return c.json({ error: "bad handle" }, 400);
    // A reserved label is not free even when no record holds it: a platform namespace answers there.
    const reserved = config.NAME_DOMAINS.includes(domain) && RESERVED_HANDLES.includes(handle);
    const status = await chain.nameStatus(domain, handle);
    return c.json({ domain, handle, ...status, reserved, taken: status.taken || reserved });
  });

  /**
   * What an address is called. Multipass holds the record, so the resolver can answer the reverse
   * question without any reverse registry: useful to a verifier who has an address and nothing else.
   */
  /**
   * An address off the wire, in the casing the chain layer wants.
   *
   * EIP-55 casing is a checksum, and an address written in one case or the other is the same address —
   * but viem refuses one whose casing does not check out, which reached a reader as a bare 500 from a
   * route that had already decided the address was well formed. Lower-cased first, so the checksum is
   * computed rather than checked, and every route reads the same canonical form whatever it was sent.
   */
  const addressOf = (raw: string): Address | undefined =>
    /^0x[0-9a-fA-F]{40}$/.test(raw) ? getAddress(raw.toLowerCase()) : undefined;

  app.get("/v1/reverse/:address", async (c) => {
    const address = addressOf(c.req.param("address"));
    if (!address) return c.json({ error: "bad address" }, 400);
    const instances = await chain.instances();
    const named = await Promise.all(
      instances
        .filter((i) => config.NAME_DOMAINS.includes(i.domain))
        .map(async (i) => ({
          domain: i.domain,
          name: await chain.reverseName(i.resolver, address as Address).catch(() => ""),
          resolver: i.resolver,
          kind: "name" as const,
        }))
    );
    const found = named.filter((n) => n.name !== "");
    // The accounts this wallet attested are names too. They come from the index rather than another
    // round of resolver calls, and they are the same names the dashboard shows.
    const mountOf = new Map(instances.map((i) => [i.domain, i]));
    const records = await chain.listRecordsByWallet(address as Address).catch(() => []);
    const held = found[0]?.name?.split(".")[0];
    const accounts = records
      .filter((r) => r.live && mountOf.has(r.domain) && !config.NAME_DOMAINS.includes(r.domain))
      .map((r) => {
        const mount = mountOf.get(r.domain);
        const { ensName } = linkName(r, mount, held);
        return ensName
          ? {
              domain: r.domain,
              name: ensName,
              resolver: (r.payload !== zeroHash ? mount?.maskedResolver : mount?.resolver) as Address,
              kind: r.payload !== zeroHash ? ("private" as const) : ("account" as const),
            }
          : undefined;
      })
      .filter((n): n is NonNullable<typeof n> => !!n && !!n.resolver);
    // What ENS itself says when asked about this address. Nobody here writes it: the holder sets their
    // own primary name, and this service answers reverse lookups from the record either way.
    const primary = await chain.primaryName(address as Address).catch(() => null);
    return c.json({
      address,
      name: found[0]?.name ?? null,
      names: [...found, ...accounts],
      primary,
      note: "answered from the Multipass record, not from a reverse registry",
      warning: WARNING,
    });
  });

  /** A wallet's dashboard: its names per domain and the references it has given (`<prefix>*` domains). */
  app.get("/v1/wallet/:address", async (c) => {
    const address = addressOf(c.req.param("address"));
    if (!address) return c.json({ error: "bad address" }, 400);
    const instances = await chain.instances();
    const parentOf = new Map(instances.map((i) => [i.domain, i.parentName]));
    const mountOf = new Map(instances.map((i) => [i.domain, i]));
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
    // The subjects: every name domain but the root, where a record is an answer rather than a name.
    const subjects = config.NAME_DOMAINS.slice(1);
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
    // Proof of humanity is written against the wallet, not a name: a voucher may hold no name at all,
    // so reading it through one could never answer for them.
    const human = records.find((r) => r.domain === config.HUMANITY_DOMAIN && r.live);
    return c.json({
      address,
      org: org
        ? { label: org.name, validUntil: new Date(Number(org.validUntil) * 1000).toISOString() }
        : null,
      humanity: human
        ? {
            level: fromBytes32(human.payload),
            until: new Date(Number(human.validUntil) * 1000).toISOString(),
          }
        : null,
      names: records
        .filter((r) => isNameDomain(r.domain))
        .map((r) => ({ ...fmt(r), ensName: `${r.name}.${parentOf.get(r.domain)}` })),
      // A humanity record is answered as `humanity` above; listed as a link it read as a private account
      // — one the page then offered to open to a candidate, with no view code to open it with.
      links: records
        .filter(
          (r) =>
            !isNameDomain(r.domain) &&
            !isVouch(r.domain) &&
            r.domain !== config.ORG_DOMAIN &&
            r.domain !== config.HUMANITY_DOMAIN
        )
        .map((r) => {
          const optedIn = r.payload !== zeroHash;
          const held = records.find((k) => k.live && isNameDomain(k.domain))?.name;
          return { ...fmt(r), optedIn, ...linkName(r, mountOf.get(r.domain), held) };
        }),
      /*
       * Everything this wallet wrote about somebody else: a reference about a person, or an answer
       * about a subject. Both are the same act from the reader's side, and `/v1/verify` already lists
       * them together — but here an answer was filed under `names` only, because a subject is a name
       * domain, and a page titled "references this wallet wrote" left the kju-is answer out.
       */
      given: records
        .filter((r) => isVouch(r.domain) || subjects.includes(r.domain))
        .map((r) => {
          const vouch = isVouch(r.domain);
          const candidate = vouch ? r.domain.slice(config.VOUCH_PREFIX.length) : r.domain;
          const parent = vouch
            ? rootParent
              ? `${candidate}.${rootParent}`
              : null
            : (parentOf.get(r.domain) ?? null);
          return {
            ...fmt(r),
            kind: vouch ? ("reference" as const) : ("answer" as const),
            candidate,
            ensName: parent ? `${r.name}.${parent}` : null,
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
    // Claimed before the send, so two requests in flight cannot both pay out. Given back if the send
    // fails: this is the one top-up a wallet gets, and a wallet with no gas cannot ask for anything
    // else — losing it to an RPC hiccup would end that person's use of the product.
    toppedUp.add(key);
    try {
      const hash = await chain.sendEth(wallet, config.GAS_TOPUP_WEI);
      return c.json({ hash, amount: config.GAS_TOPUP_WEI.toString() });
    } catch (e) {
      toppedUp.delete(key);
      return c.json({ error: `could not send gas: ${(e as Error).message}` }, 502);
    }
  });

  /** References written under a candidate: every record in the `<prefix><handle>` vouch domain. */
  const isVouchDomain = (d: string) =>
    d.startsWith(config.VOUCH_PREFIX) && d.length > config.VOUCH_PREFIX.length;

  /** A handle's standing in the reference graph: live references given by its wallet and received under it. */
  /**
   * What a handle holds here.
   *
   * `taken` is not `claimed`: a name held once and let lapse is a different thing from one nobody has
   * ever registered, and the chain says which. Collapsed into one, a person whose record ran out read
   * as somebody who had never been here, on a page carrying the references written for them.
   */
  async function standing(
    handle: string
  ): Promise<{ claimed: boolean; taken: boolean; given: number; withdrawn: number; received: number }> {
    const rootDomain = config.NAME_DOMAINS[0] ?? "";
    const status = await chain.nameStatus(rootDomain, handle);
    const isWithdrawn = (r: { payload: Hex }) => fromBytes32(r.payload) === WITHDRAWN;
    // What stands behind them: a reference withdrawn by its writer is a live record and not a reference.
    const received = new Set(
      (await chain.listRecords(`${config.VOUCH_PREFIX}${handle}`))
        .filter((r) => r.live && !isWithdrawn(r))
        .map((r) => r.name)
    ).size;
    if (!status.live || !status.wallet) {
      return { claimed: false, taken: status.taken, given: 0, withdrawn: 0, received };
    }
    /*
     * Their track record as a writer, which is the rating of references given.
     *
     * A reference somebody withdrew is still on chain — that is the point of withdrawal here — so it
     * counted as one they had given. It is the opposite: a claim they have since taken back. A long
     * record with nothing withdrawn is itself a credential, and one with several is worth knowing.
     */
    const written = (await chain.listRecordsByWallet(status.wallet)).filter(
      (r) => r.live && isVouchDomain(r.domain)
    );
    const given = new Set(written.filter((r) => !isWithdrawn(r)).map((r) => r.domain)).size;
    const withdrawn = new Set(written.filter(isWithdrawn).map((r) => r.domain)).size;
    return { claimed: true, taken: true, given, withdrawn, received };
  }

  app.get("/v1/standing/:handle", async (c) => {
    const handle = c.req.param("handle").toLowerCase();
    if (!HANDLE_RE.test(handle)) return c.json({ error: "bad handle" }, 400);
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
    /*
     * What stands, before what stood.
     *
     * The order was whatever the chain listed, so a reference somebody withdrew could sit above the
     * ones that count, and a reader scanning a wall of them met the history first. Live before lapsed,
     * and the newest of each ahead of the older, which is the order a reader reads in anyway. Nothing
     * here ranks a voucher: who is worth believing is the reader's judgement, and the standing beside
     * each name is what they make it with.
     */
    const ordered = [...records].sort(
      (a, b) => Number(b.live) - Number(a.live) || Number(b.validUntil) - Number(a.validUntil)
    );
    return {
      handle,
      domain,
      vouches: ordered.map((r) => ({
        voucher: r.name,
        voucherName: rootParent ? `${r.name}.${rootParent}` : null,
        // The reference is itself a name, in the candidate's own namespace: `<voucher>.<candidate>.<root>`.
        ensName: vouchInstance ? `${r.name}.${vouchInstance.parentName}` : null,
        wallet: r.wallet,
        statement: fromBytes32(r.payload),
        // Anyone may refer anyone; this says whether the candidate asked. The invitation travels with
        // it so a verifier can recover the signer themselves.
        solicited: !!solicitedStore.get(`${handle}:${r.name}`),
        invite: solicitedStore.get(`${handle}:${r.name}`) ?? null,
        validUntil: new Date(Number(r.validUntil) * 1000).toISOString(),
        nonce: r.nonce.toString(),
        live: r.live,
        standing: standings.get(r.name) ?? null,
        // `description` holds the letter itself when it fits, or `sha256:<hash>` when it does not.
        // The pointer is resolved here so a reader gets the text and the hash that names it, and can
        // check one against the other without asking this service to be believed.
        ...letterOf(letters.get(r.name) ?? ""),
      })),
      warning: WARNING,
    };
  }

  app.get("/v1/vouches/:handle", async (c) => {
    const handle = c.req.param("handle").toLowerCase();
    if (!HANDLE_RE.test(handle)) return c.json({ error: "bad handle" }, 400);
    return c.json(await vouchesFor(handle));
  });

  /**
   * Machine-readable verification (spec §3.4). Every field is read through the ENS resolver so an
   * agent gets exactly what any wallet would; `viewCode` (query) unmasks opted-in links.
   */
  /**
   * The references a wallet has given: an answer it wrote about a subject, or a reference it wrote
   * about a person. Both are the same act from the reader's side — this person spoke about that one —
   * so they are listed together rather than split by which mount happens to hold them.
   *
   * Ordered by how many people have spoken about the subject at all, because the subject everybody
   * answers is the one a reader arrives already recognising.
   */
  async function referencesBy(wallet: Address): Promise<Record<string, unknown>[]> {
    const subjects = config.NAME_DOMAINS.slice(1);
    const written = (await chain.listRecordsByWallet(wallet)).filter(
      (r) => r.live && (isVouchDomain(r.domain) || subjects.includes(r.domain))
    );
    if (written.length === 0) return [];
    const mounts = new Map((await chain.instances()).map((i) => [i.domain, i]));
    const rootParent = mounts.get(config.NAME_DOMAINS[0] ?? "")?.parentName ?? null;
    const spoken = new Map<string, number>(
      await Promise.all(
        [...new Set(written.map((r) => r.domain))].map(
          async (d) => [d, (await chain.listRecords(d)).filter((r) => r.live).length] as const
        )
      )
    );
    return written
      .sort((a, b) => (spoken.get(b.domain) ?? 0) - (spoken.get(a.domain) ?? 0))
      .map((r) => {
        const vouch = isVouchDomain(r.domain);
        const subject = vouch ? r.domain.slice(config.VOUCH_PREFIX.length) : r.domain;
        // A reference is a name in the subject's own namespace; an answer is a name under the subject
        // instance itself. Either way it resolves for anyone, which is the point of naming it here.
        const parent = vouch
          ? rootParent
            ? `${subject}.${rootParent}`
            : null
          : (mounts.get(r.domain)?.parentName ?? null);
        return {
          // A reader does not need to know which mount holds it, but a verifier reading the JSON does.
          kind: vouch ? "reference" : "answer",
          subject,
          // Where the subject itself can be read, so the claim is followable rather than asserted here.
          subjectName: rootParent ? `${subject}.${rootParent}` : null,
          statement: fromBytes32(r.payload),
          ensName: parent ? `${r.name}.${parent}` : null,
          validUntil: new Date(Number(r.validUntil) * 1000).toISOString(),
        };
      });
  }

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
    const r = located.resolver;

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
    /*
     * Whether this name was ever held, which is not whether it resolves now.
     *
     * A record that ran out and a name nobody registered both resolve to nothing, so an answer
     * somebody gave and let lapse read as one they never gave — on the page of the question they
     * answered. The registry knows the difference; the resolver cannot.
     */
    const taken = active
      ? true
      : await chain
          .nameStatus(instance.domain, name.split(".")[0] ?? "")
          .then((n) => n.taken)
          .catch(() => false);
    const mounts = new Map((await chain.instances()).map((i) => [i.domain, i]));
    /*
     * The label the person holds: what the private branch names their masked accounts after.
     *
     * It is the first label of a person's own name, so reading their name gets it for free — and
     * reading any other name gets a different word entirely. A mount's first label is a platform
     * handle, and building a masked name out of that produced one nobody holds, offered to a verifier
     * under "check this yourself in any ENS client".
     */
    const personal = !isDnsName(instance.domain);
    const held = personal ? (name.split(".")[0] ?? "") : "";
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
            /*
             * The name a verifier can check in any ENS client: the account's own where it is public,
             * and the person's in the private branch where it is not.
             *
             * The same function the dashboard and reverse resolution use. It was open-coded here as
             * well, and the two drifted: this copy named a masked account after whatever name was
             * asked about, which on a mount is a platform handle rather than the label a person holds.
             */
            const { ensName } = linkName(
              { name: readable(fromBytes32(record.name)) ?? "", payload: record.payload },
              mounts.get(domain),
              held || undefined
            );
            return {
              domain,
              optedIn,
              ensName,
              ...(optedIn ? { commitment: record.payload } : {}),
              ...(disclosed ? { disclosed } : {}),
            };
          })
        )
      : [];

    const evidence = [
      "wallet_binding",
      ...(humanity ? ["humanity_attestation"] : []),
      // Named by the platform, not by the mount: a verifier reads `x_account_control` either way.
      ...links.filter(Boolean).map((l) => `${platformOf(l!.domain) ?? l!.domain}_account_control`),
    ];
    return {
      name,
      instance: { domain: instance.domain, parentName: instance.parentName },
      // A name in the private branch is a narrower claim: this person has an account in that domain,
      // and the account itself stays behind a view code. A verifier should be told which they are
      // reading rather than inferring it from the shape of the name.
      branch: located.masked ? ("private" as const) : ("open" as const),
      status: active ? "active" : "inactive",
      /** Held once, whether or not it resolves now: a lapsed record is not a name nobody ever had. */
      taken,
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
      // What this person has said about anybody else. A page that shows only what others said about
      // them reads as a dossier; this is the half they wrote themselves.
      references: active ? await referencesBy(wallet) : [],
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

  const FLAT_LINKS = ["x", "telegram", "github", "discord", "google", "email", "linkedin"];

  /**
   * Which accounts to look for. A verifier arriving at a name should not have to guess the domain list,
   * so the default is what this deployment mounts — plus the flat names, for records written before the
   * DNS namespace existed.
   */
  async function linkQuery(q?: string): Promise<string[]> {
    if (q) return q.split(",").filter(Boolean);
    const mounted = (await chain.instances())
      .map((i) => i.domain)
      .filter(
        (d) =>
          !config.NAME_DOMAINS.includes(d) &&
          d !== config.ORG_DOMAIN &&
          d !== "humanity" &&
          !d.startsWith(config.VOUCH_PREFIX)
      );
    return [...new Set([...mounted, ...FLAT_LINKS])];
  }

  app.get("/v1/verify/:name", async (c) => {
    const v = await verifyName(c.req.param("name"), {
      linkDomains: await linkQuery(c.req.query("links")),
      viewCode: viewCodeOf(c) as Hex | undefined,
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
    if (!HANDLE_RE.test(handle)) return c.json({ error: "bad handle" }, 400);
    const instances = await chain.instances();
    const subjects = instances.filter((i) => config.NAME_DOMAINS.includes(i.domain));
    if (subjects.length === 0) return c.json({ error: "no name domains configured" }, 501);
    const opts = {
      linkDomains: await linkQuery(c.req.query("links")),
      viewCode: viewCodeOf(c) as Hex | undefined,
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
