import { PLATFORM_DNS_NAMES } from "@ketsuban/registrar";

/** The linked accounts Privy exposes, reduced to what the UI needs to name a person. */
export type LinkedAccounts = {
  twitter?: { username?: string | null } | null;
  github?: { username?: string | null } | null;
  telegram?: { username?: string | null } | null;
  discord?: { username?: string | null } | null;
  google?: { email?: string | null } | null;
  email?: { address?: string | null } | null;
  id?: string;
};

export type Who = {
  label: string;
  source: "x" | "github" | "telegram" | "discord" | "google" | "email" | "wallet" | "privy";
};

/**
 * How to name the signed-in person: a linked handle first, then an address, then the wallet, and the
 * Privy DID only when nothing else exists (spec §3: the user should never have to read an identifier).
 */
export function whoAmI(user: LinkedAccounts | null | undefined, wallet?: string): Who {
  const x = user?.twitter?.username;
  if (x) return { label: `@${x}`, source: "x" };
  const gh = user?.github?.username;
  if (gh) return { label: gh, source: "github" };
  const tg = user?.telegram?.username;
  if (tg) return { label: `@${tg}`, source: "telegram" };
  const dc = user?.discord?.username;
  if (dc) return { label: dc, source: "discord" };
  const goog = user?.google?.email;
  if (goog) return { label: goog, source: "google" };
  const mail = user?.email?.address;
  if (mail) return { label: mail, source: "email" };
  if (wallet) return { label: `${wallet.slice(0, 6)}…${wallet.slice(-4)}`, source: "wallet" };
  return { label: user?.id ?? "signed in", source: "privy" };
}

/** Platform domains the user has linked, in the order the attester names them. */
export function linkedDomains(user: LinkedAccounts | null | undefined): string[] {
  const pairs: [string, unknown][] = [
    ["x", user?.twitter?.username],
    ["github", user?.github?.username],
    ["telegram", user?.telegram?.username],
    ["discord", user?.discord?.username],
    ["google", user?.google?.email],
    ["email", user?.email?.address],
  ];
  return pairs.filter(([, v]) => !!v).map(([k]) => k);
}

/** A connected account with the label a person recognises: the handle or address, never the platform. */
export type ConnectedAccount = { domain: string; label: string };

export function connectedAccounts(user: LinkedAccounts | null | undefined): ConnectedAccount[] {
  const pairs: [string, string | null | undefined][] = [
    ["x", user?.twitter?.username ? `@${user.twitter.username}` : null],
    ["github", user?.github?.username],
    ["telegram", user?.telegram?.username ? `@${user.telegram.username}` : null],
    ["discord", user?.discord?.username],
    ["google", user?.google?.email],
    ["email", user?.email?.address],
  ];
  return pairs.filter(([, label]) => !!label).map(([domain, label]) => ({ domain, label: label as string }));
}

/**
 * The domain this deployment attests an account into. A platform mounted at its own DNS name takes
 * `x.com`; an email takes the domain that issued the address, so `tim@peeramid.xyz` lands in
 * `peeramid.xyz`. A deployment that predates the DNS namespace still answers to the flat name.
 *
 * A DNS domain nobody has deployed yet is still the answer: the relay mounts it when the account is
 * attested, so nobody with an ordinary mail host is turned away. Nothing comes back only when the
 * account has no domain at all — a platform this build does not know.
 */
export function domainFor(account: ConnectedAccount, domains: readonly string[]): string | undefined {
  const dns = account.domain === "email" ? emailHost(account.label) : PLATFORM_DNS_NAMES[account.domain];
  if (dns && domains.includes(dns)) return dns;
  if (domains.includes(account.domain)) return account.domain;
  return dns;
}

function emailHost(address: string): string | undefined {
  const at = address.lastIndexOf("@");
  return at === -1 ? undefined : address.slice(at + 1).toLowerCase();
}
