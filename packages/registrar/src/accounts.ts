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
