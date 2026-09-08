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
