import { z } from "zod";
import type { Address, Hex } from "viem";

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
});
export type AttestResult = z.infer<typeof attestResultSchema>;

export const verifySchema = z.object({
  name: z.string(),
  instance: z.object({ domain: z.string(), parentName: z.string() }),
  status: z.enum(["active", "inactive"]),
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
  evidence: z.array(z.string()),
  decision: z.string(),
  warning: z.string(),
});
export type Verification = z.infer<typeof verifySchema>;

export const vouchesSchema = z.object({
  handle: z.string(),
  domain: z.string(),
  vouches: z.array(
    z.object({
      voucher: z.string(),
      voucherName: z.string().nullable(),
      wallet: z.string(),
      statement: z.string(),
      validUntil: z.string(),
      nonce: z.string(),
      live: z.boolean(),
      standing: z
        .object({ claimed: z.boolean(), given: z.number(), received: z.number() })
        .nullable()
        .optional(),
      letter: z.string().nullable().optional(),
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
  ethRegistry: address.nullable().optional(),
  ethRegistrar: address.nullable().optional(),
  paymentToken: address.nullable().optional(),
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
});
export type PreflightRead = z.infer<typeof preflightSchema>;

export const profileSchema = z.object({
  handle: z.string(),
  names: z.array(z.object({ instance: z.string(), name: z.string(), verification: verifySchema.nullable() })),
  vouches: vouchesSchema.shape.vouches,
  standing: z.object({ claimed: z.boolean(), given: z.number(), received: z.number() }),
  warning: z.string(),
});
export type ProfileRead = z.infer<typeof profileSchema>;

export const enclaveKeySchema = z.object({ address: address, publicKey: hex });
export const disclosedSchema = z.object({
  name: z.string(),
  domain: z.string(),
  disclosed: z.object({ handle: z.string(), platformId: z.string() }),
  warning: z.string(),
});
export type Disclosed = z.infer<typeof disclosedSchema>;

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
  names: z.array(walletRecord.extend({ ensName: z.string() })),
  links: z.array(
    walletRecord.extend({
      optedIn: z.boolean(),
      ensName: z.string().nullable().optional(),
      /** Why there is no name: "private", or "not-a-label" for a handle ENS cannot hold */
      nameless: z.string().nullable().optional(),
    })
  ),
  given: z.array(walletRecord.extend({ candidate: z.string(), ensName: z.string().nullable() })),
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
export function createApi(apiUrl: string, attestUrl: string, fetchFn: Fetch = fetch) {
  const base = apiUrl.replace(/\/$/, "");
  const call = (url: string, init?: RequestInit) =>
    fetchFn(url, {
      ...init,
      signal: init?.signal ?? timeoutSignal(init?.method && init.method !== "GET" ? 45_000 : 20_000),
    });

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
    async deliver(result: AttestResult, deliveryToken?: string): Promise<{ ok: true; txHash: Hex }> {
      // The browser uses the token-free relay; the delivery route belongs to the enclave.
      const path = deliveryToken ? "/v1/cre/delivery" : "/v1/submit";
      const res = await call(`${base}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(deliveryToken ? { "x-delivery-token": deliveryToken } : {}),
        },
        body: JSON.stringify(result),
      });
      return (await readJson(res)) as { ok: true; txHash: Hex };
    },

    async ens(name: string, keys?: string[]): Promise<EnsResolution> {
      const q = keys?.length ? `?keys=${encodeURIComponent(keys.join(","))}` : "";
      return ensSchema.parse(await readJson(await call(`${base}/v1/ens/${encodeURIComponent(name)}${q}`)));
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

    /** Who owns a `.eth` label on the registry the bridge checks; `null` owner means nobody here does. */
    async ethLabel(label: string): Promise<z.infer<typeof ethLabelSchema>> {
      return ethLabelSchema.parse(await readJson(await call(`${base}/v1/eth-label/${label}`)));
    },

    /** The key a view code is encrypted to, so only the enclave can open a disclosure. */
    async enclaveKey(): Promise<{ address: Address; publicKey: Hex }> {
      return enclaveKeySchema.parse(await readJson(await call(`${base}/v1/enclave-key`)));
    },

    /** Hand the attester a candidate-signed permission to read one masked account. */
    async disclose(wire: object): Promise<{ ok: true; expiresAt: string }> {
      const res = await call(`${base}/v1/disclose`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(wire),
      });
      return (await readJson(res)) as { ok: true; expiresAt: string };
    },

    /** Read a masked account the candidate allowed; `reader` must match a grant addressed to one wallet. */
    async disclosed(name: string, domain: string, reader?: string): Promise<Disclosed> {
      const q = reader ? `?reader=${reader}` : "";
      return disclosedSchema.parse(
        await readJson(
          await call(`${base}/v1/disclose/${encodeURIComponent(name)}/${encodeURIComponent(domain)}${q}`)
        )
      );
    },

    async reverse(address: string): Promise<ReverseRead> {
      return reverseSchema.parse(await readJson(await call(`${base}/v1/reverse/${address}`)));
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
      if (opts.viewCode) q.set("viewCode", opts.viewCode);
      const qs = q.toString();
      return profileSchema.parse(
        await readJson(await call(`${base}/v1/profile/${encodeURIComponent(handle)}${qs ? `?${qs}` : ""}`))
      );
    },

    async vouches(handle: string): Promise<Vouches> {
      return vouchesSchema.parse(
        await readJson(await call(`${base}/v1/vouches/${encodeURIComponent(handle)}`))
      );
    },

    async verify(name: string, opts: { links?: string[]; viewCode?: Hex } = {}): Promise<Verification> {
      const q = new URLSearchParams();
      if (opts.links?.length) q.set("links", opts.links.join(","));
      if (opts.viewCode) q.set("viewCode", opts.viewCode);
      const qs = q.toString();
      return verifySchema.parse(await readJson(await call(`${base}/v1/verify/${name}${qs ? `?${qs}` : ""}`)));
    },
  };
}

export type Api = ReturnType<typeof createApi>;
