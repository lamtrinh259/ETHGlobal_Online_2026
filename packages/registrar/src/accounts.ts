import type { LinkedAccount } from "./types.js";

/** Multipass platform domain → Privy linked-account `type` (B.4 `toPrivyType`) */
export const PLATFORM_DOMAINS: Readonly<Record<string, string>> = {
  x: "twitter_oauth",
  telegram: "telegram",
  discord: "discord_oauth",
  github: "github_oauth",
  google: "google_oauth",
  linkedin: "linkedin_oauth",
  email: "email",
};

export const PLATFORM_DOMAIN_NAMES: readonly string[] = Object.keys(PLATFORM_DOMAINS);

/**
 * The DNS name each platform actually is. A record under `x` collides with a person called `x` and
 * says nothing about which service; `x.com` says both. These become the ENS namespace an account
 * resolves in: `<handle>.x.com.www.<root>`.
 *
 * Email has no single name here: the address carries its own domain, which is the point of `dnsNameFor`.
 */
export const PLATFORM_DNS_NAMES: Readonly<Record<string, string>> = {
  x: "x.com",
  telegram: "t.me",
  discord: "discord.com",
  github: "github.com",
  google: "google.com",
  linkedin: "linkedin.com",
};

/** Is this a DNS name a namespace can be built from: labels of `[a-z0-9-]`, at least two of them. */
export function isDnsName(value: string): boolean {
  const labels = value.toLowerCase().split(".");
  return labels.length >= 2 && labels.every((l) => /^[a-z0-9-]{1,63}$/.test(l));
}

/**
 * Where an account's name belongs: a platform's own DNS name, or for an email the domain it was issued
 * by. Returns nothing when the account cannot name a namespace — an email with no domain, a platform
 * this deployment does not map.
 */
export function dnsNameFor(domain: string, account: { username?: string }): string | undefined {
  if (domain === "email") {
    const at = (account.username ?? "").lastIndexOf("@");
    const host = at === -1 ? "" : account.username!.slice(at + 1).toLowerCase();
    return isDnsName(host) ? host : undefined;
  }
  return PLATFORM_DNS_NAMES[domain];
}

/** The label an account takes inside that namespace: a handle, or an email's local part. */
export function labelFor(domain: string, account: { username?: string }): string | undefined {
  const raw = domain === "email" ? (account.username ?? "").split("@")[0] : (account.username ?? "");
  const label = raw.toLowerCase();
  return /^[a-z0-9_-]{1,63}$/.test(label) ? label : undefined;
}

export function toPrivyType(domain: string): string {
  const t = PLATFORM_DOMAINS[domain];
  if (!t) throw new Error(`accounts: unknown platform domain "${domain}"`);
  return t;
}

export function parseLinkedAccounts(raw: string): LinkedAccount[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("accounts: linked_accounts is not an array");
  return parsed as LinkedAccount[];
}

/** DID ↔ wallet: the intent's wallet must be one of the DID's linked wallets */
export function hasLinkedWallet(linked: LinkedAccount[], wallet: string): boolean {
  const w = wallet.toLowerCase();
  return linked.some(
    (a) => a.type === "wallet" && typeof a.address === "string" && a.address.toLowerCase() === w
  );
}

/**
 * The platform a domain stands for. A DNS name that is a platform's own is that platform; any other DNS
 * name is an email domain, because nobody could enumerate every mail host. A bare word is a flat domain
 * from a deployment that predates the DNS namespace.
 */
export function platformOf(domain: string): string | undefined {
  const named = Object.entries(PLATFORM_DNS_NAMES).find(([, dns]) => dns === domain);
  if (named) return named[0];
  if (isDnsName(domain)) return "email";
  return PLATFORM_DOMAINS[domain] ? domain : undefined;
}

export type PlatformAccount = { subject: string; username: string };

/**
 * Pick the linked account for a platform domain and normalise it to
 * `{ subject, username }` — the platform-issued id and the handle.
 */
export function pickPlatformAccount(linked: LinkedAccount[], domain: string): PlatformAccount {
  const type = toPrivyType(domain);
  const acct = linked.find((a) => a.type === type);
  if (!acct) throw new Error(`accounts: no linked ${type} account`);

  let subject: string | undefined;
  let username: string | undefined;
  switch (type) {
    case "telegram":
      subject = acct.telegram_user_id ?? acct.telegramUserId;
      username = acct.username;
      break;
    case "google_oauth":
      subject = acct.subject;
      username = acct.email;
      break;
    case "email":
      subject = acct.address;
      username = acct.address;
      break;
    default:
      subject = acct.subject;
      username = acct.username;
  }
  if (!subject) throw new Error(`accounts: ${type} account has no subject`);
  if (!username) throw new Error(`accounts: ${type} account has no handle`);
  return { subject: String(subject), username };
}

/**
 * The account a domain asks for, with the label it takes inside that domain's namespace. An email domain
 * only accepts an address issued by it, so `gmail.com` never holds a record for an address at
 * `peeramid.xyz`, and the label is what is left once the domain is taken off.
 */
export function pickAccountFor(linked: LinkedAccount[], domain: string): PlatformAccount & { label: string } {
  const platform = platformOf(domain);
  if (!platform) throw new Error(`accounts: unknown domain "${domain}"`);
  const acct = pickPlatformAccount(linked, platform);
  const dns = dnsNameFor(platform, acct);
  if (isDnsName(domain) && dns !== domain) {
    throw new Error(`accounts: ${acct.username} is not an account at ${domain}`);
  }
  const label = labelFor(platform, acct);
  if (!label) throw new Error(`accounts: "${acct.username}" cannot be an ENS label`);
  return { ...acct, label };
}
