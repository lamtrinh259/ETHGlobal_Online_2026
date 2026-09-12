import { getAddress } from "viem";
import { z } from "zod";
import { forPreview } from "@ketsuban/registrar";

const schema = z.object({
  privyAppId: z.string().min(1),
  privyClientId: z.string().min(1),
  apiUrl: z.string().url(),
  attestUrl: z.string().url(),
  /** Whether the intent is attested somewhere other than this deployment's own API */
  confidential: z.boolean(),
  chainId: z.coerce.number().int().positive(),
  // EIP-55 casing is a checksum, and viem refuses an address whose casing does not match its own. An
  // address pasted in lower case from an explorer is the same address; normalising here keeps that
  // from surfacing much later as a transaction that will not build.
  multipass: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .transform((v) => getAddress(v)),
  nameDomains: z.array(z.string().min(1)).min(1),
  parentNames: z.array(z.string().min(1)).min(1),
});

export type WebConfig = z.infer<typeof schema> & {
  instances: { domain: string; parentName: string; parentLabel: string }[];
};

const split = (s: string | undefined) =>
  (s ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

/** Browser configuration from NEXT_PUBLIC_* — identifiers only, never secrets */
/**
 * Whether the intent goes somewhere other than this deployment's own attester.
 *
 * The signing step is the one that sees a person's identity token and their linked accounts. Run on
 * the API's own node, the operator could read both; run in a Chainlink CRE enclave, nobody can, and
 * the trigger lives at a URL that is not this API's. That difference is a real guarantee to a person
 * deciding whether to sign, so the page must claim it only when it holds — the address is the honest
 * way to know, because it is the same fact the browser acts on.
 */
export function isConfidential(apiUrl: string, attestUrl: string): boolean {
  try {
    return new URL(attestUrl).origin !== new URL(apiUrl).origin;
  } catch {
    return false;
  }
}

/**
 * The host this container is served at, as the platform tells it.
 *
 * A Coolify preview lives at `{{pr_id}}.{{domain}}` and says so through `COOLIFY_FQDN` (or
 * `COOLIFY_URL`, with the scheme). Both are runtime variables, read here on the server and handed to
 * the browser inside the config, so a preview is addressed by what the platform gave it, not by what
 * was baked in at build time.
 */
export function servedAt(env: Record<string, string | undefined> = process.env): string | undefined {
  return env.COOLIFY_FQDN || env.COOLIFY_URL || undefined;
}

export function loadWebConfig(env: Record<string, string | undefined> = process.env): WebConfig {
  /*
   * A preview web app talks to the preview API, not to production.
   *
   * The variables carry the production addresses; a preview is the same build served under a pull
   * request's own host, and the API it belongs to sits under the same id. So the id in front of this
   * host goes in front of the API's and the attester's too — in production there is none, and
   * nothing changes.
   */
  const at = servedAt(env);
  const apiUrl = forPreview(env.NEXT_PUBLIC_API_URL ?? "", at);
  const attestUrl = forPreview(env.NEXT_PUBLIC_ATTEST_URL ?? "", at);
  const c = schema.parse({
    privyAppId: env.NEXT_PUBLIC_PRIVY_APP_ID,
    privyClientId: env.NEXT_PUBLIC_PRIVY_CLIENT_ID,
    apiUrl,
    attestUrl,
    confidential: isConfidential(apiUrl, attestUrl),
    chainId: env.NEXT_PUBLIC_CHAIN_ID,
    multipass: env.NEXT_PUBLIC_MULTIPASS,
    nameDomains: split(env.NEXT_PUBLIC_NAME_DOMAINS),
    parentNames: split(env.NEXT_PUBLIC_PARENT_NAMES),
  });
  if (c.nameDomains.length !== c.parentNames.length) {
    throw new Error("NEXT_PUBLIC_NAME_DOMAINS and NEXT_PUBLIC_PARENT_NAMES must have the same length");
  }
  return {
    ...c,
    instances: c.nameDomains.map((domain, i) => ({
      domain,
      parentName: c.parentNames[i],
      parentLabel: c.parentNames[i].split(".")[0],
    })),
  };
}

/**
 * Where this deployment is served from.
 *
 * Read in three places with three different fallbacks: a card pointing at localhost, a share snippet
 * with no origin at all, and a secure-context answer of "no" that changed which avatars render. A
 * deployment that forgets the variable degraded three ways, none of them visible in the app itself.
 */
export function siteUrl(env: Record<string, string | undefined> = process.env): string {
  // A preview is served under its own host, and every link this app writes about itself must say so.
  return forPreview((env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, ""), servedAt(env));
}

/** Whether this deployment is served over https, which decides what an `http://` record may render. */
export function siteIsSecure(): boolean {
  return siteUrl().startsWith("https:");
}
