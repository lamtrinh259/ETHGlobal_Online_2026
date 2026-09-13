import { z } from "zod";
import type { Address, Hex } from "viem";
import { NAME_KINDS } from "@ketsuban/registrar";

const hex = z
  .string()
  .regex(/^0x[0-9a-fA-F]*$/)
  .transform((s) => s as Hex);

export const attestResultSchema = z.object({
  record: z.object({
    name: hex,
    id: hex,
    domainName: hex,
    validUntil: z.string(),
    nonce: z.string(),
    wallet: hex,
    payload: hex,
  }),
  signature: hex,
  viewCode: z.object({ ephemeralPubkey: hex, nonce: hex, ciphertext: hex }).nullable(),
  /** For a reference: whether the candidate asked for it, and why not when they did not */
  solicited: z.boolean().optional(),
  unsolicitedReason: z.string().optional(),
});
export type AttestResult = z.infer<typeof attestResultSchema>;

export const verifySchema = z.object({
  name: z.string(),
  instance: z.object({ domain: z.string(), parentName: z.string() }),
  /** Which half of the namespace this name lives in: the open one, or the private mirror */
  branch: z.enum(["open", "private"]).optional(),
  status: z.enum(["active", "inactive"]),
  /** Held once, whether or not it resolves now: a lapsed record is not a name nobody ever had. */
  taken: z.boolean().default(false),
  wallet: z.string().nullable(),
  answer: z.string().nullable(),
  expiresAt: z.string().nullable(),
  humanity: z.object({ level: z.string(), until: z.string().nullable() }).nullable(),
  links: z.array(
    z.object({
      domain: z.string(),
      optedIn: z.boolean(),
      /** The name this account answers at, which anyone can check in their own ENS client */
      ensName: z.string().nullable().optional(),
      commitment: z.string().optional(),
      disclosed: z.object({ handle: z.string(), platformId: z.string() }).optional(),
    })
  ),
  profile: z
    .object({
      avatar: z.string().nullable(),
      description: z.string().nullable(),
      url: z.string().nullable(),
      email: z.string().nullable(),
    })
    .optional(),
  /** What this person has said about anyone else: an answer about a subject, a reference about a person */
  references: z
    .array(
      z.object({
        kind: z.enum(["answer", "reference"]),
        subject: z.string(),
        subjectName: z.string().nullable(),
        statement: z.string(),
        ensName: z.string().nullable(),
        validUntil: z.string(),
      })
    )
    .default([]),
  evidence: z.array(z.string()),
  decision: z.string(),
  warning: z.string(),
});
export type Verification = z.infer<typeof verifySchema>;

/**
 * What the browser needs to ask World for a proof of unique humanity. The signature is made server
 * side with a key that never reaches here, so this cannot be built locally — see
 * https://docs.world.org/world-id/idkit/signatures.
 */
export const humanityChallengeSchema = z.object({
  app_id: z.string(),
  action: z.string(),
  // Whichever the attester was configured with; the widget is told rather than deciding.
  environment: z.enum(["production", "staging", "sandbox"]),
  /** Which credential to ask for; an older API that does not say means the Orb-backed one */
  credential: z.enum(["proof_of_human", "selfie"]).default("proof_of_human"),
  /** What the proof is bound to: the wallet, lower-cased, because a signal is hashed as bytes */
  signal: z.string(),
  rp_context: z.object({
    rp_id: z.string(),
    nonce: z.string(),
    created_at: z.number(),
    expires_at: z.number(),
    signature: z.string(),
  }),
});
export type HumanityChallenge = z.infer<typeof humanityChallengeSchema>;

export const humanitySchema = z.object({
  ok: z.literal(true),
  level: z.string(),
  until: z.string(),
  nullifier: z.string(),
  txHash: z.string(),
  renewal: z.boolean(),
});

export const vouchesSchema = z.object({
  handle: z.string(),
  domain: z.string(),
  vouches: z.array(
    z.object({
      voucher: z.string(),
      voucherName: z.string().nullable(),
      /** The reference's own name, in the candidate's namespace */
      ensName: z.string().nullable().optional(),
      wallet: z.string(),
      statement: z.string(),
      validUntil: z.string(),
      nonce: z.string(),
      live: z.boolean(),
      /** Whether the candidate asked for this reference; anyone may write one either way */
      solicited: z.boolean().default(false),
      invite: z
        .object({ handle: z.string(), voucher: z.string(), exp: z.string(), signature: z.string() })
        .nullable()
        .default(null),
      standing: z
        .object({ claimed: z.boolean(), given: z.number(), received: z.number() })
        .nullable()
        .optional(),
      letter: z.string().nullable().optional(),
      /** Set when the letter is kept off chain: the hash the record names, so a reader can check it */
      letterHash: z.string().nullable().optional(),
    })
  ),
  warning: z.string(),
});
export type Vouches = z.infer<typeof vouchesSchema>;
export type Vouch = Vouches["vouches"][number];

const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((s) => s as Address);
export const contractsSchema = z.object({
  instances: z.array(
    z.object({
      domain: z.string(),
      registry: address,
      resolver: address,
      parentName: z.string(),
      parentLabel: z.string(),
      /** Where a masked record in this domain is named, when the deployment has a private branch */
      maskedParentName: z.string().optional(),
    })
  ),
  bridge: address,
  permissionedResolver: address.nullable(),
  /** One resolver at the root answering every name from Multipass, where the deployment runs that way */
  rootResolver: address.nullable().optional(),
  ethRegistry: address.nullable().optional(),
  ethRegistrar: address.nullable().optional(),
  paymentToken: address.nullable().optional(),
  /** Whether this deployment can ask for a proof of humanity at all */
  humanity: z.boolean().optional(),
});

export const explainSchema = z.object({
  name: z.string(),
  says: z.string(),
  kind: z.enum(NAME_KINDS),
  domain: z.string().optional(),
  label: z.string().optional(),
});

export const ethLabelSchema = z.object({
  label: z.string(),
  registry: address,
  owner: address.nullable(),
});
export type Contracts = z.infer<typeof contractsSchema>;

export const ensSchema = z.object({
  name: z.string(),
  universalResolver: address,
  resolver: address,
  addr: address.nullable(),
  texts: z.record(z.string()),
  status: z.enum(["active", "inactive"]),
  warning: z.string(),
});
export type EnsResolution = z.infer<typeof ensSchema>;

export const preflightSchema = z.object({
  ok: z.boolean(),
  warnings: z.array(z.string()),
  /*
   * Which key the chain expects, and which one this service says it signs with. Optional because an
   * older attester answers without them, and a page that reads this must degrade rather than fail: the
   * banner these warnings drive matters more than the comparison they enable.
   */
  registrar: z.object({ signsAs: address.nullable() }).optional(),
  multipass: z.object({ domains: z.array(z.object({ registrar: address })) }).optional(),
});
export type PreflightRead = z.infer<typeof preflightSchema>;

export const profileSchema = z.object({
  handle: z.string(),
  names: z.array(z.object({ instance: z.string(), name: z.string(), verification: verifySchema.nullable() })),
  vouches: vouchesSchema.shape.vouches,
  standing: z.object({
    claimed: z.boolean(),
    taken: z.boolean().default(false),
    given: z.number(),
    withdrawn: z.number().default(0),
    received: z.number(),
  }),
  warning: z.string(),
});
export type ProfileRead = z.infer<typeof profileSchema>;

export const enclaveKeySchema = z.object({ address: address, publicKey: hex });
/** How many references a person holds, which is the one fact a link to them should carry. */
export const standingSchema = z.object({
  claimed: z.boolean(),
  /** Held once, whether or not it is held now: a lapsed name is not a name nobody has ever had. */
  taken: z.boolean().default(false),
  /** References they wrote and have since taken back: the rating of vouches given. */
  withdrawn: z.number().default(0),
  given: z.number(),
  received: z.number(),
});
export type Standing = z.infer<typeof standingSchema>;

/**
 * One person's neighbourhood in the reference graph, with its shape and where trust reached.
 * A count is not a shape: this is what tells three strangers from a ring that only refers itself.
 */
export const graphSchema = z.object({
  handle: z.string(),
  nodes: z.array(
    z.object({
      handle: z.string(),
      received: z.number(),
      given: z.number(),
      human: z.boolean(),
      rank: z.number(),
      /** SybilScore, 0–100: what accumulated behind them; an older attester says nothing */
      score: z.number().default(0),
    })
  ),
  edges: z.array(z.object({ from: z.string(), to: z.string() })),
  metrics: z.object({
    mutual: z.number(),
    referrerDensity: z.number(),
    referrersReferringEachOther: z.number(),
    clusterSize: z.number(),
  }),
  rank: z.number(),
  /** SybilScore, 0–100: proved humanity is a floor, every live reference adds a capped share of its writer's score */
  score: z.number().default(0),
  human: z.boolean(),
  /** How many people in the whole graph have proved humanity: where trust starts from */
  seeds: z.number(),
  warning: z.string(),
});
export type Graph = z.infer<typeof graphSchema>;

/** One statement's provisional reading by the fast council: text classified, not a person judged. */
export const readingSchema = z.object({
  polarity: z.number(),
  conviction: z.number().nullable(),
  rationale: z.string(),
  model: z.string(),
  provisional: z.literal(true),
});
const readingSummarySchema = z.object({
  of: z.number(),
  read: z.number(),
  mean: z.number().nullable(),
  supportive: z.number(),
  critical: z.number(),
});
export const readingsSchema = z.object({
  handle: z.string(),
  /** Whether a council is configured at all; without one every statement is listed unread */
  council: z.boolean(),
  model: z.string().nullable(),
  received: z.array(z.object({ voucher: z.string(), says: z.string(), reading: readingSchema.nullable() })),
  given: z.array(z.object({ candidate: z.string(), says: z.string(), reading: readingSchema.nullable() })),
  summary: z.object({ received: readingSummarySchema, given: readingSummarySchema }),
  warning: z.string(),
});
export type Readings = z.infer<typeof readingsSchema>;

/** Demo only: what the admin page reads and what a reset reports. */
export const adminHumanitySchema = z.object({
  wallet: z.string(),
  handle: z.string().nullable(),
  onchain: z.object({ exists: z.boolean(), nonce: z.string() }),
  bound: z.number(),
});
export type AdminHumanity = z.infer<typeof adminHumanitySchema>;
export const adminResetSchema = z.object({
  wallet: z.string(),
  handle: z.string().nullable(),
  forgotten: z.number(),
  existed: z.boolean(),
  deleted: z.union([z.object({ txHash: z.string() }), z.object({ error: z.string() })]).nullable(),
});
export type AdminReset = z.infer<typeof adminResetSchema>;
/** Demo only: what unlinking a person's Privy accounts did. */
export const adminUnlinkSchema = z.object({
  wallet: z.string(),
  handle: z.string().nullable(),
  did: z.string(),
  unlinked: z.array(z.object({ type: z.string(), handle: z.string() })),
  failed: z.array(z.object({ type: z.string(), status: z.number() })),
  deleted: z.array(z.object({ domain: z.string(), txHash: z.string() })).default([]),
});
export type AdminUnlink = z.infer<typeof adminUnlinkSchema>;
/** Demo only: one row of the admin's account list. */
export const adminAccountSchema = z.object({
  wallet: z.string(),
  handle: z.string().nullable(),
  humanity: z.boolean(),
  bound: z.number(),
});
export type AdminAccount = z.infer<typeof adminAccountSchema>;
/** Demo only: whether a reference needs the Selfie Check right now, for everyone. */
export const adminSelfieCheckSchema = z.object({
  required: z.boolean(),
  configured: z.boolean(),
  offered: z.boolean(),
});
export type AdminSelfieCheck = z.infer<typeof adminSelfieCheckSchema>;

/** A candidate's invitation as it is kept: the signed message, its number as a string. */
export type WireInvite = {
  handle: string;
  voucher: string;
  exp: string;
  requires?: string[];
  signature: string;
};

/** An employer's invitation to be read against their policy, and how far the person has come. */
export const policyInviteSchema = z.object({
  code: z.string(),
  kind: z.literal("policy"),
  inviter: z.string(),
  inviterName: z.string(),
  platform: z.string(),
  account: z.string(),
  policy: z.string(),
  expiresAt: z.string(),
  expired: z.boolean(),
  /** `invited`: not here yet · `linked`: account attested, no name · `claimed`: a page the bar applies to */
  status: z.enum(["invited", "linked", "claimed"]),
  candidate: z.string().nullable(),
});
export type PolicyInviteRead = z.infer<typeof policyInviteSchema>;
export const invitesSchema = z.object({
  handle: z.string(),
  invites: z.array(
    z.object({
      code: z.string(),
      kind: z.literal("vouch"),
      requires: z.array(z.string()),
      expiresAt: z.string(),
      expired: z.boolean().default(false),
      /** Who wrote a reference with it, each with the name the reference answers at */
      usedBy: z.array(z.object({ voucher: z.string(), ensName: z.string().nullable() })).default([]),
    })
  ),
  asked: z.array(policyInviteSchema).default([]),
});
export type Invites = z.infer<typeof invitesSchema>;
export type Reading = z.infer<typeof readingSchema>;

export const disclosedSchema = z.object({
  name: z.string(),
  domain: z.string(),
  disclosed: z.object({ handle: z.string(), platformId: z.string() }),
  warning: z.string(),
});
export type Disclosed = z.infer<typeof disclosedSchema>;

/** What a name is sharing right now: enough to say who can read what, never the grant itself. */
/** A person whose handle looks like what was typed, with the references that say who they are. */
export const findSchema = z.object({
  q: z.string(),
  /** How many matched, which is not how many came back: the list is cut at ten. */
  total: z.number().optional(),
  matches: z.array(
    z.object({
      handle: z.string(),
      wallet: z.string().optional(),
      claimed: z.boolean(),
      given: z.number(),
      received: z.number(),
    })
  ),
});
export type Found = z.infer<typeof findSchema>;
export type Match = Found["matches"][number];

/** Who holds a platform account here, or why they cannot be found. */
export const whoSchema = z.object({
  found: z.boolean(),
  domain: z.string(),
  handle: z.string(),
  wallet: z.string().optional(),
  candidate: z.string().nullable().optional(),
  note: z.string().optional(),
  standing: z.object({ claimed: z.boolean(), given: z.number(), received: z.number() }).nullable().optional(),
});
export type Who = z.infer<typeof whoSchema>;

/** What one instance name holds: who it is about, and what people answered under it. */
/**
 * What one instance name says it is for, and what people published under it.
 *
 * Parsed rather than cast, like every other read here. The records are what the name itself holds —
 * an older attester answers without them, which is why they default rather than being required, and a
 * page that reads them must not depend on the shape being whatever it happened to be.
 */
export const instanceReadSchema = z.object({
  domain: z.string(),
  /** How many have answered, which is not how many came back: the read carries a page of them. */
  total: z.number().optional(),
  parentName: z.string(),
  description: z.string().nullable().default(null),
  records: z
    .object({
      name: z.string().optional(),
      description: z.string().default(""),
      url: z.string().default(""),
      avatar: z.string().default(""),
    })
    .optional(),
  answers: z
    .array(
      z.object({
        handle: z.string(),
        ensName: z.string(),
        answer: z.string(),
        validUntil: z.string(),
      })
    )
    .default([]),
});
export type InstanceRead = z.infer<typeof instanceReadSchema>;

export const grantsSchema = z.object({
  name: z.string(),
  grants: z.array(
    z.object({
      id: hex,
      domains: z.array(z.string()),
      audience: address,
      audienceName: z.string(),
      expiresAt: z.string(),
    })
  ),
});
export type Grants = z.infer<typeof grantsSchema>;
export type Grant = Grants["grants"][number];

export const reverseSchema = z.object({
  address: z.string(),
  name: z.string().nullable(),
  names: z.array(
    z.object({
      domain: z.string(),
      name: z.string(),
      resolver: z.string(),
      /** Their own name, an account in the open, or an account named in the private branch */
      kind: z.enum(["name", "account", "private"]).optional(),
    })
  ),
  /** What ENS itself answers for the address: set by its holder, never by this service */
  primary: z.string().nullable().optional(),
  note: z.string(),
});
export type ReverseRead = z.infer<typeof reverseSchema>;

export const nameStatusSchema = z.object({
  domain: z.string(),
  handle: z.string(),
  taken: z.boolean(),
  /** A label a platform namespace already owns, such as `x` or `github`: never free */
  reserved: z.boolean().optional(),
  wallet: z.string().nullable(),
  live: z.boolean(),
});
export type NameStatus = z.infer<typeof nameStatusSchema>;

const walletRecord = z.object({
  domain: z.string(),
  name: z.string(),
  payload: z.string(),
  validUntil: z.string(),
  nonce: z.string(),
  live: z.boolean(),
});
export const walletSchema = z.object({
  address: z.string(),
  /** Set when this wallet is an onboarded organisation, which may issue references uninvited */
  org: z.object({ label: z.string(), validUntil: z.string() }).nullable().optional(),
  /** Proof of humanity is keyed by wallet, so a voucher with no name still has an answer here */
  humanity: z.object({ level: z.string(), until: z.string() }).nullable().optional(),
  names: z.array(walletRecord.extend({ ensName: z.string() })),
  links: z.array(
    walletRecord.extend({
      optedIn: z.boolean(),
      ensName: z.string().nullable().optional(),
      /** Why there is no name: "private", or "not-a-label" for a handle ENS cannot hold */
      nameless: z.string().nullable().optional(),
    })
  ),
  given: z.array(
    walletRecord.extend({
      /** A reference about a person, or an answer about a subject; an older attester says nothing */
      kind: z.enum(["reference", "answer"]).default("reference"),
      candidate: z.string(),
      ensName: z.string().nullable(),
    })
  ),
  balance: z.string().regex(/^\d+$/),
  gasTopup: z.object({ enabled: z.boolean(), amount: z.string().regex(/^\d+$/), available: z.boolean() }),
  warning: z.string(),
});
export type WalletDashboard = z.infer<typeof walletSchema>;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

// 20s abort signal; AbortSignal.timeout is unsupported on older iOS Safari, so fall back to a
// manual AbortController there.
function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal !== "undefined" && "timeout" in AbortSignal) return AbortSignal.timeout(ms);
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

export type Fetch = typeof fetch;

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => "");
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // A 2xx that isn't JSON means a gateway answered instead of the service.
    if (res.ok)
      throw new ApiError(res.status, "The service sent a reply the app could not read — try again.");
  }
  if (!res.ok) {
    const msg = (body as { error?: string } | null)?.error ?? `HTTP ${res.status}`;
    throw new ApiError(res.status, msg);
  }
  return body;
}

/**
 * Client for apps/api. Mutations get a longer timeout: aborting a POST the server already
 * committed and retrying risks a double submit.
 */
/**
 * A view code goes in a header, never in a URL.
 *
 * It is the one-time pad that unmasks an account on chain: permanent, unrevocable, and the whole
 * secret. In a query string it lands in the attester's access log, in this app's, in every proxy
 * between them and in the browser's history — and a secret that never expires cannot be taken back
 * once it is written somewhere. A header is sent to one place and logged by none of them by default.
 */
function viewCodeHeader(viewCode?: string): Record<string, string> {
  return viewCode ? { "x-view-code": viewCode } : {};
}

export function createApi(apiUrl: string, attestUrl: string, fetchFn: Fetch = fetch) {
  const base = apiUrl.replace(/\/$/, "");
  const call = async (url: string, init?: RequestInit) => {
    const write = !!init?.method && init.method !== "GET";
    try {
      return await fetchFn(url, {
        ...init,
        signal: init?.signal ?? timeoutSignal(write ? 45_000 : 20_000),
      });
    } catch (e) {
      /*
       * A timed-out write is not a failed one. The attester may have finished after this gave up, and
       * "signal timed out" reads as "nothing happened" — so the next attempt reuses a nonce the chain
       * has already seen and is refused. Say what actually happened instead.
       */
      const name = (e as Error)?.name;
      if (write && (name === "TimeoutError" || name === "AbortError")) {
        throw new Error(
          "the attester did not answer in time. It may still have written the record — reload this page before trying again, so the next attempt reads the nonce the chain now holds."
        );
      }
      throw e;
    }
  };

  return {
    async nonce(
      wallet: string,
      domain: string
    ): Promise<{ exists: boolean; next: bigint; ready: boolean; reason: string | null }> {
      const b = (await readJson(
        await call(`${base}/v1/nonce?wallet=${wallet}&domain=${encodeURIComponent(domain)}`)
      )) as {
        exists: boolean;
        next: string;
        ready?: boolean;
        reason?: string | null;
      };
      // An older deployment does not report readiness; absence means "no reason not to".
      return { exists: b.exists, next: BigInt(b.next), ready: b.ready !== false, reason: b.reason ?? null };
    },

    /** POST the signed request to the attester (API node fallback or CRE HTTP trigger) */
    async attest(wire: object): Promise<AttestResult> {
      const res = await call(attestUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(wire),
      });
      return attestResultSchema.parse(await readJson(res));
    },

    /** Hand a signed record to the relay, which pays and submits `bridge.verify` */
    async deliver(
      result: AttestResult,
      deliveryToken?: string,
      description?: string
    ): Promise<{ ok: true; txHash: Hex; letterWritten?: boolean }> {
      // The browser uses the token-free relay; the delivery route belongs to the enclave.
      const path = deliveryToken ? "/v1/cre/delivery" : "/v1/submit";
      const res = await call(`${base}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(deliveryToken ? { "x-delivery-token": deliveryToken } : {}),
        },
        // The letter rides with the record: the relay writes it in the same transaction.
        body: JSON.stringify(description ? { ...result, description } : result),
      });
      return (await readJson(res)) as { ok: true; txHash: Hex; letterWritten?: boolean };
    },

    async ens(name: string, keys?: string[], opts: { signal?: AbortSignal } = {}): Promise<EnsResolution> {
      const q = keys?.length ? `?keys=${encodeURIComponent(keys.join(","))}` : "";
      return ensSchema.parse(
        await readJson(await call(`${base}/v1/ens/${encodeURIComponent(name)}${q}`, { signal: opts.signal }))
      );
    },

    /** The deployment's own view of whether it is wired correctly; 503 carries the reasons. */
    async preflight(): Promise<PreflightRead> {
      const res = await fetchFn(`${base}/v1/preflight`);
      const body = await res.json().catch(() => null);
      const parsed = preflightSchema.safeParse(body);
      if (parsed.success) return parsed.data;
      throw new ApiError(res.status, `preflight unavailable (HTTP ${res.status})`);
    },

    async contracts(): Promise<Contracts> {
      return contractsSchema.parse(await readJson(await call(`${base}/v1/instances`)));
    },

    /** What a name would claim here, whether or not anything resolves at it. */
    async explain(name: string, opts: { signal?: AbortSignal } = {}): Promise<z.infer<typeof explainSchema>> {
      return explainSchema.parse(
        await readJson(await call(`${base}/v1/explain/${encodeURIComponent(name)}`, { signal: opts.signal }))
      );
    },

    /** Who owns a `.eth` label on the registry the bridge checks; `null` owner means nobody here does. */
    async ethLabel(label: string): Promise<z.infer<typeof ethLabelSchema>> {
      return ethLabelSchema.parse(await readJson(await call(`${base}/v1/eth-label/${label}`)));
    },

    /** Keep a picture and get the URL an `avatar` record can hold; the bytes decide what is stored. */
    async uploadAvatar(file: File): Promise<{ id: string; url: string }> {
      const body = new FormData();
      body.set("file", file);
      const res = await call(`${base}/v1/avatar`, { method: "POST", body });
      return (await readJson(res)) as { id: string; url: string };
    },

    /** The key a view code is encrypted to, so only the enclave can open a disclosure. */
    async enclaveKey(): Promise<{ address: Address; publicKey: Hex }> {
      return enclaveKeySchema.parse(await readJson(await call(`${base}/v1/enclave-key`)));
    },

    /** Hand the attester a candidate-signed permission to read one masked account. */
    async disclose(wire: object): Promise<{ ok: true; id: Hex; domains: string[]; expiresAt: string }> {
      const res = await call(`${base}/v1/disclose`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(wire),
      });
      return (await readJson(res)) as { ok: true; id: Hex; domains: string[]; expiresAt: string };
    },

    /**
     * Keep a letter too long for a text record, and get the pointer one can hold. The hash is what
     * goes on chain, so whoever reads the letter can check it is the one the record names.
     */
    async storeLetter(text: string): Promise<{ hash: string; ref: string; bytes: number }> {
      const res = await call(`${base}/v1/letter`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      return (await readJson(res)) as { hash: string; ref: string; bytes: number };
    },

    /**
     * The signed invitation a short code stands for; checked the same as one that arrived in full.
     * Either kind: a candidate's (`invite` holds the signed message) or an employer's (the fields of
     * `policyInviteSchema`, with how far the person has come).
     */
    async invite(
      code: string,
      opts: { signal?: AbortSignal } = {}
    ): Promise<{ code: string; kind: "vouch"; invite: WireInvite } | PolicyInviteRead> {
      const body = (await readJson(
        await call(`${base}/v1/invite/${encodeURIComponent(code)}`, { signal: opts.signal })
      )) as { kind?: string };
      if (body.kind === "policy") return policyInviteSchema.parse(body);
      return body as { code: string; kind: "vouch"; invite: WireInvite };
    },

    /**
     * Invitations this name made: the ones a candidate can still hand out, and — as `asked` — everyone
     * an employer invited to be read against a bar, with how far each has come. A link outlives the
     * page that made it.
     */
    async invites(handle: string): Promise<Invites> {
      return invitesSchema.parse(
        await readJson(await call(`${base}/v1/invites/${encodeURIComponent(handle)}`))
      );
    },

    /** Demo only: a wallet's humanity state, for the admin page; the token is the whole gate. */
    async adminHumanity(token: string, q: { wallet?: string; handle?: string }): Promise<AdminHumanity> {
      const params = new URLSearchParams(q.wallet ? { wallet: q.wallet } : { handle: q.handle ?? "" });
      return adminHumanitySchema.parse(
        await readJson(
          await call(`${base}/v1/admin/humanity?${params}`, { headers: { "x-admin-token": token } })
        )
      );
    },
    /** Demo only: forget the wallet's nullifiers and delete its humanity record on chain. */
    async adminHumanityReset(token: string, q: { wallet?: string; handle?: string }): Promise<AdminReset> {
      const res = await call(`${base}/v1/admin/humanity/reset`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-token": token },
        body: JSON.stringify(q),
      });
      return adminResetSchema.parse(await readJson(res));
    },
    /**
     * The view codes this session's wallets hold, re-derived by the service from the Privy identity
     * token: nothing for the person to keep, and the same answer on every device.
     */
    async viewCodes(idToken: string): Promise<{ codes: Record<string, Hex>; given: Record<string, Hex> }> {
      const res = await call(`${base}/v1/viewcodes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      return z
        .object({ codes: z.record(z.string(), hex), given: z.record(z.string(), hex).default({}) })
        .parse(await readJson(res));
    },
    /** A code somebody gave this person, kept by the service against their session. */
    async keepViewCode(idToken: string, name: string, viewCode: Hex): Promise<void> {
      await call(`${base}/v1/viewcodes/given`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idToken, name, viewCode }),
      });
    },
    /** Demo only: every account the deployment knows, for the admin's list. */
    async adminAccounts(token: string): Promise<AdminAccount[]> {
      const res = await call(`${base}/v1/admin/accounts`, { headers: { "x-admin-token": token } });
      return z.object({ accounts: z.array(adminAccountSchema) }).parse(await readJson(res)).accounts;
    },
    /** Demo only: every Selfie Check on the platform, reset at once. */
    async adminHumanityResetAll(token: string): Promise<{ forgotten: number; deleted: unknown[] }> {
      const res = await call(`${base}/v1/admin/humanity/reset-all`, {
        method: "POST",
        headers: { "x-admin-token": token },
      });
      return z.object({ forgotten: z.number(), deleted: z.array(z.unknown()) }).parse(await readJson(res));
    },
    /** Demo only: unlink every account but the wallets from the person's Privy user. */
    async adminPrivyUnlink(token: string, q: { wallet?: string; handle?: string }): Promise<AdminUnlink> {
      const res = await call(`${base}/v1/admin/privy/unlink`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-token": token },
        body: JSON.stringify(q),
      });
      return adminUnlinkSchema.parse(await readJson(res));
    },
    /** Demo only: whether the Selfie Check is in force for everyone. */
    async adminSelfieCheck(token: string): Promise<AdminSelfieCheck> {
      return adminSelfieCheckSchema.parse(
        await readJson(await call(`${base}/v1/admin/selfie-check`, { headers: { "x-admin-token": token } }))
      );
    },
    /** Demo only: turn the Selfie Check off, or back on, for everyone at once. */
    async adminSelfieCheckSet(token: string, required: boolean): Promise<AdminSelfieCheck> {
      const res = await call(`${base}/v1/admin/selfie-check`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-token": token },
        body: JSON.stringify({ required }),
      });
      return adminSelfieCheckSchema.parse(await readJson(res));
    },
    /** Keep a signed invitation of either kind and get the short code that stands for it. */
    async storeInvite(wire: object): Promise<{ code: string }> {
      const res = await call(`${base}/v1/invite`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(wire),
      });
      return (await readJson(res)) as { code: string };
    },

    /** What people published under one instance name: the answers, and what the name says it is for. */
    /**
     * `signal` is for a caller that would rather render without this than wait for it — the front page
     * asks about every subject it offers, and a cold attester must not hold up the first thing anybody
     * sees. The default timeout is the one a person waiting on a page they asked for would accept.
     */
    async instance(domain: string, opts: { signal?: AbortSignal } = {}): Promise<InstanceRead> {
      return instanceReadSchema.parse(
        await readJson(
          await call(`${base}/v1/instance/${encodeURIComponent(domain)}`, { signal: opts.signal })
        )
      );
    },

    /** People whose handle looks like this, most-referenced first: which `bob` did you mean. */
    async find(q: string): Promise<Found> {
      return findSchema.parse(await readJson(await call(`${base}/v1/find?q=${encodeURIComponent(q)}`)));
    },

    /** Who holds a platform account here; a private account cannot be found and says so. */
    async who(domain: string, handle: string, viewCode?: string): Promise<Who> {
      const q = new URLSearchParams({ domain, handle });
      // Only someone the candidate gave the code to can find a private account; it is the permission.
      return whoSchema.parse(
        await readJson(await call(`${base}/v1/who?${q.toString()}`, { headers: viewCodeHeader(viewCode) }))
      );
    },

    /** Live permissions on a name, so its holder can see who can read which account. */
    async disclosures(name: string): Promise<Grants> {
      return grantsSchema.parse(
        await readJson(await call(`${base}/v1/disclosures/${encodeURIComponent(name)}`))
      );
    },

    /** Take one back; the wire carries the holder's signature over a dated revocation. */
    async revoke(wire: object): Promise<{ ok: true; id: string; domains: string[] }> {
      const res = await call(`${base}/v1/revoke`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(wire),
      });
      return (await readJson(res)) as { ok: true; id: string; domains: string[] };
    },

    /** Read a masked account the candidate allowed; `reader` must match a grant addressed to one wallet. */
    async disclosed(
      name: string,
      domain: string,
      reader?: string,
      as?: string,
      /** The secret out of the link, for a grant made for whoever holds one */
      linkKey?: string
    ): Promise<Disclosed> {
      const parts = [
        reader ? `reader=${reader}` : "",
        as ? `as=${encodeURIComponent(as)}` : "",
        linkKey ? `k=${encodeURIComponent(linkKey)}` : "",
      ].filter(Boolean);
      const q = parts.length ? `?${parts.join("&")}` : "";
      return disclosedSchema.parse(
        await readJson(
          await call(`${base}/v1/disclose/${encodeURIComponent(name)}/${encodeURIComponent(domain)}${q}`)
        )
      );
    },

    async reverse(address: string, opts: { signal?: AbortSignal } = {}): Promise<ReverseRead> {
      return reverseSchema.parse(
        await readJson(await call(`${base}/v1/reverse/${address}`, { signal: opts.signal }))
      );
    },

    async nameStatus(domain: string, handle: string): Promise<NameStatus> {
      return nameStatusSchema.parse(
        await readJson(
          await call(`${base}/v1/name/${encodeURIComponent(domain)}/${encodeURIComponent(handle)}`)
        )
      );
    },

    async wallet(address: string): Promise<WalletDashboard> {
      return walletSchema.parse(await readJson(await call(`${base}/v1/wallet/${address}`)));
    },

    async gas(wallet: string): Promise<{ hash: Hex; amount: string }> {
      return z.object({ hash: hex, amount: z.string() }).parse(
        await readJson(
          await call(`${base}/v1/gas`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ wallet }),
          })
        )
      );
    },

    async profile(handle: string, opts: { links?: string[]; viewCode?: Hex } = {}): Promise<ProfileRead> {
      const q = new URLSearchParams();
      if (opts.links?.length) q.set("links", opts.links.join(","));
      const qs = q.toString();
      return profileSchema.parse(
        await readJson(
          await call(`${base}/v1/profile/${encodeURIComponent(handle)}${qs ? `?${qs}` : ""}`, {
            headers: viewCodeHeader(opts.viewCode),
          })
        )
      );
    },
    async standing(handle: string, opts: { signal?: AbortSignal } = {}): Promise<Standing> {
      return standingSchema.parse(
        await readJson(
          await call(`${base}/v1/standing/${encodeURIComponent(handle)}`, { signal: opts.signal })
        )
      );
    },
    async graph(handle: string, opts: { signal?: AbortSignal } = {}): Promise<Graph> {
      return graphSchema.parse(
        await readJson(await call(`${base}/v1/graph/${encodeURIComponent(handle)}`, { signal: opts.signal }))
      );
    },
    async readings(handle: string, opts: { signal?: AbortSignal } = {}): Promise<Readings> {
      return readingsSchema.parse(
        await readJson(
          await call(`${base}/v1/readings/${encodeURIComponent(handle)}`, { signal: opts.signal })
        )
      );
    },
    async vouches(handle: string): Promise<Vouches> {
      return vouchesSchema.parse(
        await readJson(await call(`${base}/v1/vouches/${encodeURIComponent(handle)}`))
      );
    },

    /** A proof request signed as this app; without one World will not issue a proof at all. */
    async humanityChallenge(wallet: string): Promise<HumanityChallenge> {
      const res = await call(`${base}/v1/humanity/challenge`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet }),
      });
      return humanityChallengeSchema.parse(await readJson(res));
    },

    /** Hand the proof back to the relay, which verifies it with World and writes the record. */
    async proveHumanity(wallet: string, proof: unknown): Promise<z.infer<typeof humanitySchema>> {
      const res = await call(`${base}/v1/humanity`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet, proof }),
      });
      return humanitySchema.parse(await readJson(res));
    },

    async verify(name: string, opts: { links?: string[]; viewCode?: Hex } = {}): Promise<Verification> {
      const q = new URLSearchParams();
      if (opts.links?.length) q.set("links", opts.links.join(","));
      const qs = q.toString();
      return verifySchema.parse(
        await readJson(
          await call(`${base}/v1/verify/${name}${qs ? `?${qs}` : ""}`, {
            headers: viewCodeHeader(opts.viewCode),
          })
        )
      );
    },
  };
}

export type Api = ReturnType<typeof createApi>;
