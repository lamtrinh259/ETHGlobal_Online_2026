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
        href: `/claim?renew=${n.domain}`,
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
        label: `reference for ${g.candidate}`,
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
      href: live || idx === 0 ? `/claim?renew=${i.domain}` : "/claim",
    };
  });
}

export type StepState = "done" | "now" | "todo" | "pending";
export type JourneyStep = { id: string; label: string; detail: string; state: StepState };

/**
 * The voucher's three steps. Attesting the accounts they worked from is onboarding, done once on the
 * profile, not per candidate: vouching for someone is proving you are one real person and writing the
 * reference. `humanity` is the World Selfie Check gate, shown as pending until partner access lands.
 */
export function vouchSteps(
  candidate: string,
  at: { authenticated: boolean; published: boolean }
): JourneyStep[] {
  const stage = !at.authenticated ? "signin" : at.published ? "done" : "write";
  const mark = (mine: string, done: boolean): StepState => (done ? "done" : stage === mine ? "now" : "todo");
  return [
    {
      id: "signin",
      label: "Sign in",
      detail: "Google, X or email. A wallet is created for you: no app, no seed phrase, no fee.",
      state: mark("signin", at.authenticated),
    },
    {
      id: "humanity",
      label: "Prove you are one real person",
      detail:
        "A short face scan through World. It stops one person running ten voucher accounts. We never see the image.",
      state: "pending",
    },
    {
      id: "write",
      label: `Write and sign the reference for ${candidate}`,
      detail:
        "Pick the name you sign as, then a few words, and a letter if you have more to say. Permanent: you can update or withdraw it later, never delete it.",
      state: mark("write", at.published),
    },
  ];
}
