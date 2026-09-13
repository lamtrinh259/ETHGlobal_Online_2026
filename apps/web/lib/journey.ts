import type { WalletDashboard } from "./api";

export const VOUCH_PREFIX = "~";

type Instances = { instances: { domain: string; parentName: string; parentLabel: string }[] };

/** Vouch domains (`~alice`) are name domains too: the voucher's handle becomes `<voucher>.alice.<root>`. */
export function isNameDomainFor(domain: string, config: Instances & { nameDomains: string[] }): boolean {
  return config.nameDomains.includes(domain) || domain.startsWith(VOUCH_PREFIX);
}

/** ENS parent a record in `domain` lands under; vouch domains nest under the candidate's root name. */
export function parentNameFor(domain: string, config: Instances): string | undefined {
  const known = config.instances.find((i) => i.domain === domain)?.parentName;
  if (known) return known;
  const root = config.instances[0];
  if (root && domain.startsWith(VOUCH_PREFIX) && domain.length > VOUCH_PREFIX.length) {
    return `${domain.slice(VOUCH_PREFIX.length)}.${root.parentName}`;
  }
  return undefined;
}

export type VoucherProgress = {
  /** The organisation this wallet is, if any: it writes references without an invitation */
  org?: { label: string; validUntil: string };
  /** Live linked-account record exists (work context corroborated) */
  linked: boolean;
  /** Live handle in the root name domain */
  named?: string;
  /** Live statement this wallet already wrote for the candidate */
  existing?: { statement: string; validUntil: string; nonce: string; ensName: string | null };
};

/** What the voucher has already done, read from their wallet dashboard, so the flow resumes after a reload. */
export function voucherProgress(
  dash: WalletDashboard | undefined,
  rootDomain: string,
  candidate: string
): VoucherProgress {
  if (!dash) return { linked: false };
  const named = dash.names.find((n) => n.live && n.domain === rootDomain)?.name;
  const given = dash.given.find((g) => g.live && g.candidate === candidate);
  return {
    org: dash.org ?? undefined,
    linked: dash.links.some((l) => l.live),
    named,
    existing: given
      ? { statement: given.payload, validUntil: given.validUntil, nonce: given.nonce, ensName: given.ensName }
      : undefined,
  };
}

export type ClaimProgress = { handle?: string; answered: Set<string> };

/** The candidate's live root name and which subject instances already hold a live answer. */
export function claimProgress(
  dash: WalletDashboard | undefined,
  instances: Instances["instances"]
): ClaimProgress {
  const [root, ...subjects] = instances;
  if (!dash || !root) return { answered: new Set() };
  const handle = dash.names.find((n) => n.live && n.domain === root.domain)?.name;
  const answered = new Set(
    subjects
      .filter((s) =>
        dash.names.some((n) => n.live && n.domain === s.domain && n.name === handle && n.payload)
      )
      .map((s) => s.domain)
  );
  return { handle, answered };
}

export type Attention = {
  kind: "name" | "link" | "given";
  label: string;
  /** Days until expiry; negative when already expired */
  daysLeft: number;
  href: string;
};

/** Records expired or expiring within `days`, with where to renew them. Expired vouch references are left alone. */
export function needsAttention(dash: WalletDashboard | undefined, nowMs: number, days = 7): Attention[] {
  if (!dash) return [];
  const left = (iso: string) => Math.floor((Date.parse(iso) - nowMs) / 86_400_000);
  const soon = (iso: string) => left(iso) <= days;
  const out: Attention[] = [
    ...dash.names
      .filter((n) => soon(n.validUntil))
      .map((n) => ({
        kind: "name" as const,
        label: n.ensName,
        daysLeft: left(n.validUntil),
        href: "/me",
      })),
    ...dash.links
      .filter((l) => soon(l.validUntil))
      .map((l) => ({
        kind: "link" as const,
        label: `${l.domain} link`,
        daysLeft: left(l.validUntil),
        href: "/me#link",
      })),
    ...dash.given
      .filter((g) => g.live && soon(g.validUntil))
      .map((g) => ({
        kind: "given" as const,
        label: `vouch for ${g.candidate}`,
        daysLeft: left(g.validUntil),
        href: `/vouch/${g.candidate}`,
      })),
  ];
  return out.sort((a, b) => a.daysLeft - b.daysLeft);
}

export type NameRow = {
  domain: string;
  ensName: string;
  /** Live record under the held handle, if any */
  live?: { payload: string; validUntil: string; nonce: string };
  /** Expired record exists (renewal, not a first claim) */
  expired: boolean;
  href: string;
};

/** One row per instance for the dashboard: what is answered, what is missing, where to go. */
export function nameRows(dash: WalletDashboard | undefined, instances: Instances["instances"]): NameRow[] {
  const { handle } = claimProgress(dash, instances);
  if (!handle) return [];
  return instances.map((i, idx) => {
    const mine = (dash?.names ?? []).filter((n) => n.domain === i.domain && n.name === handle);
    const live = mine.find((n) => n.live);
    return {
      domain: i.domain,
      ensName: `${handle}.${i.parentName}`,
      live: live ? { payload: live.payload, validUntil: live.validUntil, nonce: live.nonce } : undefined,
      expired: !live && mine.length > 0,
      href: `/me`,
    };
  });
}

export type StepState = "done" | "now" | "todo" | "pending";
export type JourneyStep = { id: string; label: string; detail: string; state: StepState };

/**
 * Where a detour goes back to.
 *
 * Linking an account is a one-time step on the dashboard, asked of somebody halfway through writing a
 * reference for a particular person. Sent there with nothing to come back with, they have to remember
 * who they were referring and find them again — and the page they left promises the opposite.
 *
 * The path arrives on the query string, so it is whatever a link somebody was sent says: only a path
 * inside this app is one to follow. A leading `//` or `/\\` is a host, not a path.
 */
export function returnTo(path: string | undefined): string | undefined {
  if (!path || !path.startsWith("/")) return undefined;
  if (path.startsWith("//") || path.startsWith("/\\")) return undefined;
  return path;
}

/** What going back is for, said in terms of the page it goes back to rather than as "go back". */
export function whatIsBack(path: string): string {
  const vouch = /^\/vouch\/([^/?#]+)/.exec(path);
  if (vouch) return `referring ${decodeURIComponent(vouch[1])}`;
  const person = /^\/p\/([^/?#]+)/.exec(path);
  if (person) return `${decodeURIComponent(person[1])}\u2019s page`;
  return "where you were";
}
