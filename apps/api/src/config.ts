import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { z } from "zod";
import type { Address, Hex } from "viem";

const hex = z.string().regex(/^0x[0-9a-fA-F]+$/);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const jwk = z.object({ kty: z.literal("EC"), crv: z.literal("P-256"), x: z.string(), y: z.string() });

/**
 * Service configuration. Everything is an environment variable so the same image runs
 * locally (anvil), on Sepolia, and behind Coolify. Instance subjects are data, not code.
 */
export const configSchema = z.object({
  PORT: z.coerce.number().int().default(8787),
  RPC_URL: z.string().url(),
  CHAIN_ID: z.coerce.number().int(),
  MULTIPASS: address,
  MULTIPASS_EIP712_NAME: z.string().default("MultipassDNS"),
  MULTIPASS_EIP712_VERSION: z.string().default("1.0.0"),
  BRIDGE: address,
  FACTORY: address,
  /** A later factory carrying the DNS namespace, when the first one is too old to have built it */
  NAMESPACE_FACTORY: address.optional(),
  /** ENSv2 `.eth` registry the bridge checks ownership against, for "bring your own name" */
  ETH_REGISTRY: address.optional(),
  /** ENSv2 `.eth` registrar, so a test deployment can hand someone a name to bring */
  ETH_REGISTRAR: address.optional(),
  /** ERC-20 the registrar prices names in; mintable on a test chain */
  PAYMENT_TOKEN: address.optional(),
  /** How long the list of mounts is reused before reading it again; mounts change rarely */
  MOUNT_CACHE_SECONDS: z.coerce.number().int().nonnegative().default(30),
  /** How many test names one wallet may be given; the relay pays for each */
  ETH_NAMES_PER_WALLET: z.coerce.number().int().positive().default(3),
  /** How long a registered test name lasts (default 28 days) */
  ETH_NAME_DURATION: z.coerce.number().int().positive().default(2_419_200),
  /** The registrar's minimum commitment age, waited out between the two steps */
  COMMITMENT_WAIT_SECONDS: z.coerce.number().int().nonnegative().default(60),
  /** How long a commitment stays usable; past this the registrar reverts and a new one is needed */
  COMMITMENT_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(240),
  /** Relayer key that submits `bridge.verify`; a Privy server wallet replaces it in production */
  RELAYER_KEY: hex,
  PRIVY_APP_ID: z.string(),
  PRIVY_VERIFICATION_KEY_JWK: z.string().transform((s, ctx) => {
    const r = jwk.safeParse(JSON.parse(s));
    if (!r.success) ctx.addIssue({ code: "custom", message: "invalid P-256 JWK" });
    return r.success ? r.data : (undefined as never);
  }),
  /** Comma-separated name domains this deployment serves, e.g. "kju-is" */
  NAME_DOMAINS: z.string().transform((s) =>
    s
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean)
  ),
  /** Node registrar fallback (spec B.9.7); unset in production where the enclave signs */
  REGISTRAR_KEY: hex.optional(),
  VIEWCODE_KEY: hex.optional(),
  /** Shared secret the CRE delivery must present in `x-delivery-token` */
  DELIVERY_TOKEN: z.string().min(16).optional(),
  RECORD_TERM_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(30 * 24 * 3600),
  /** Root instance registry (mounted under .eth) — vouch instances nest beneath it */
  REGISTRY: address.optional(),
  /** ENSv2 UniversalResolver; set it to expose the independent resolution path (`/v1/ens/:name`) */
  UNIVERSAL_RESOLVER: address.optional(),
  /** Stock PermissionedResolver every instance forwards to */
  PERMISSIONED_RESOLVER: address.optional(),
  /** Registrar address the relay initialises new vouch domains with */
  REGISTRAR_ADDRESS: address.optional(),
  /** Window size for log reads; providers cap wide ranges and truncate silently */
  RPC_LOG_WINDOW: z.coerce.number().int().positive().default(10_000),
  /** Where the in-process index persists its snapshot; empty keeps it in memory only */
  DATA_DIR: z.string().default("/data"),
  /** How often the index reads new blocks */
  INDEX_POLL_SECONDS: z.coerce.number().int().positive().default(15),
  /**
   * Block the deployment starts at; the index scans from here. Leaving it at 0 makes a first run walk
   * the whole chain, which is slow enough to look broken — set it to the block the contracts were
   * deployed at.
   */
  DEPLOY_BLOCK: z.coerce.number().int().nonnegative().default(0),
  /**
   * Whether a statement in a vouch domain needs the candidate's signed invitation. Off by default:
   * anyone may refer anyone, and a reference the candidate never asked for is reported as unsolicited
   * rather than refused. A deployment that wants the closed behaviour sets this to `true`.
   */
  /**
   * How many bytes of letters this service will hold. Nothing gates writing one, and the same
   * directory holds grants and avatars, so an unbounded store is a way to take the deployment down.
   */
  LETTER_STORE_BYTES: z
    .string()
    .default("26214400")
    .transform((v) => Number(v))
    .pipe(z.number().int().positive()),
  REQUIRE_INVITE: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  /**
   * Multipass domain whose holders are onboarded organisations. A holder may issue a reference for a
   * handle nobody has claimed yet, which is how a university writes to a graduate who has never heard
   * of this product.
   */
  ORG_DOMAIN: z.string().min(1).default("org"),
  /** Shared secret for `POST /v1/org`; without it no organisation can be onboarded through the API */
  ORG_TOKEN: z.string().min(16).optional(),
  /** Prefix of per-candidate vouch domains (`~alice`) */
  VOUCH_PREFIX: z.string().min(1).default("~"),
  /** Below this the relayer cannot pay for records; the preflight warns. Default 0.002 ETH. */
  RELAYER_MIN_WEI: z
    .string()
    .regex(/^\d+$/)
    .default("2000000000000000")
    .transform((s) => BigInt(s)),
  /** Test-gas the relayer sends once to a wallet holding a live name (wei); 0 disables `POST /v1/gas` */
  GAS_TOPUP_WEI: z
    .string()
    .regex(/^\d+$/)
    .default("0")
    .transform((s) => BigInt(s)),
  /** Comma-separated browser origins allowed to call the API; "*" allows any (default) */
  CORS_ORIGINS: z
    .string()
    .default("*")
    .transform((v) =>
      v
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean)
    ),
});

export type Config = Omit<
  z.infer<typeof configSchema>,
  | "MULTIPASS"
  | "BRIDGE"
  | "FACTORY"
  | "RELAYER_KEY"
  | "REGISTRAR_KEY"
  | "VIEWCODE_KEY"
  | "REGISTRY"
  | "PERMISSIONED_RESOLVER"
  | "UNIVERSAL_RESOLVER"
  | "REGISTRAR_ADDRESS"
  | "NAMESPACE_FACTORY"
  | "ETH_REGISTRY"
  | "ETH_REGISTRAR"
  | "PAYMENT_TOKEN"
> & {
  MULTIPASS: Address;
  BRIDGE: Address;
  FACTORY: Address;
  RELAYER_KEY: Hex;
  REGISTRAR_KEY?: Hex;
  VIEWCODE_KEY?: Hex;
  REGISTRY?: Address;
  PERMISSIONED_RESOLVER?: Address;
  UNIVERSAL_RESOLVER?: Address;
  REGISTRAR_ADDRESS?: Address;
  NAMESPACE_FACTORY?: Address;
  ETH_REGISTRY?: Address;
  ETH_REGISTRAR?: Address;
  PAYMENT_TOKEN?: Address;
};

/**
 * Turn a config failure into lines an operator can act on: which variable, and what was wrong.
 * A container that dies silently on a missing secret is the hardest deployment bug to read.
 */
export function explainConfigError(err: unknown): string[] {
  if (err instanceof z.ZodError) {
    return err.issues.map((i) => {
      const key = i.path.join(".") || "(root)";
      const missing = i.code === "invalid_type" && "received" in i && i.received === "undefined";
      return `${key}: ${missing ? "missing" : i.message}`;
    });
  }
  return [(err as Error)?.message ?? String(err)];
}

/** Addresses written by the forge deploy scripts (`deployments/<chainId>.json`, `local.json`) */
const deploymentFile = z.object({
  chainId: z.number().int(),
  multipass: address,
  bridge: address,
  factory: address,
  namespaceFactory: address.optional(),
  ethRegistry: address.optional(),
  ethRegistrar: address.optional(),
  paymentToken: address.optional(),
  registry: address.optional(),
  permissionedResolver: address.optional(),
  universalResolver: address.optional(),
});

/** The addresses a deployment artifact carries, as environment values. */
function fromDeployment(d: z.infer<typeof deploymentFile>): Record<string, string> {
  return {
    CHAIN_ID: String(d.chainId),
    MULTIPASS: d.multipass,
    BRIDGE: d.bridge,
    FACTORY: d.factory,
    ...(d.namespaceFactory ? { NAMESPACE_FACTORY: d.namespaceFactory } : {}),
    ...(d.ethRegistry ? { ETH_REGISTRY: d.ethRegistry } : {}),
    ...(d.ethRegistrar ? { ETH_REGISTRAR: d.ethRegistrar } : {}),
    ...(d.paymentToken ? { PAYMENT_TOKEN: d.paymentToken } : {}),
    ...(d.registry ? { REGISTRY: d.registry } : {}),
    ...(d.permissionedResolver ? { PERMISSIONED_RESOLVER: d.permissionedResolver } : {}),
    ...(d.universalResolver ? { UNIVERSAL_RESOLVER: d.universalResolver } : {}),
  };
}

/**
 * The deployment this build ships for a chain, when it has one. An operator sets the keys and the RPC;
 * every address is already known, and half of every deployment problem has been one of them missing.
 */
export function bundledDeployment(chainId: string | undefined): Record<string, string> {
  if (!chainId) return {};
  try {
    const require = createRequire(import.meta.url);
    return fromDeployment(deploymentFile.parse(require(`@ketsuban/contracts/deployments/${chainId}.json`)));
  } catch {
    return {};
  }
}

/**
 * Load from the environment; when `DEPLOYMENT_FILE` points at a forge deployment artifact its
 * addresses fill MULTIPASS / BRIDGE / FACTORY / CHAIN_ID unless set explicitly, and a chain this build
 * ships a deployment for fills whatever is still missing.
 */
/**
 * Lay the environment over what a deployment already knows. An empty value is a real answer for a
 * setting — `DATA_DIR=""` means keep nothing on disk — but it is not an address, so it never blanks one
 * a deployment supplied.
 */
function overlay(known: Record<string, string>, env: Record<string, string | undefined>) {
  const merged: Record<string, string | undefined> = { ...known };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (value === "" && key in known) continue;
    merged[key] = value;
  }
  return merged;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  let merged = overlay(bundledDeployment(env.CHAIN_ID), env);
  if (env.DEPLOYMENT_FILE) {
    const d = deploymentFile.parse(JSON.parse(readFileSync(env.DEPLOYMENT_FILE, "utf8")));
    merged = overlay(fromDeployment(d), env);
  }
  return configSchema.parse(merged) as Config;
}
