import { z } from "zod";
import type { Hex } from "viem";

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
    })
  ),
  warning: z.string(),
});
export type Vouches = z.infer<typeof vouchesSchema>;
export type Vouch = Vouches["vouches"][number];

export const nameStatusSchema = z.object({
  domain: z.string(),
  handle: z.string(),
  taken: z.boolean(),
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
  names: z.array(walletRecord.extend({ ensName: z.string() })),
  links: z.array(walletRecord.extend({ optedIn: z.boolean() })),
  given: z.array(walletRecord.extend({ candidate: z.string(), ensName: z.string().nullable() })),
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
    async nonce(wallet: string, domain: string): Promise<{ exists: boolean; next: bigint }> {
      const b = (await readJson(
        await call(`${base}/v1/nonce?wallet=${wallet}&domain=${encodeURIComponent(domain)}`)
      )) as {
        exists: boolean;
        next: string;
      };
      return { exists: b.exists, next: BigInt(b.next) };
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
      const res = await call(`${base}/v1/cre/delivery`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(deliveryToken ? { "x-delivery-token": deliveryToken } : {}),
        },
        body: JSON.stringify(result),
      });
      return (await readJson(res)) as { ok: true; txHash: Hex };
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
