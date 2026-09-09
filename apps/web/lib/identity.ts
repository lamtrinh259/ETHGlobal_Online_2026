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
