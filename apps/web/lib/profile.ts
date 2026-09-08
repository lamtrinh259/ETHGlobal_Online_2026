import type { Verification, Vouch } from "./api";
import type { WebConfig } from "./config";

/** The instance whose parent name is the root people namespace (first configured). */
export function rootInstance(config: Pick<WebConfig, "instances">) {
  return config.instances[0];
}

/** Every ENS name a handle owns across the configured instances, root first. */
export function profileNames(handle: string, config: Pick<WebConfig, "instances">): string[] {
  return config.instances.map((i) => `${handle}.${i.parentName}`);
}

export type Check = { id: string; label: string; ok: boolean; detail: string };

export type Policy = {
  /** Subject instances (by Multipass domain) whose answer a verifier requires, e.g. ["kju-is"] */
  requiredAnswers: string[];
  /** Minimum linked accounts (any platform) */
  minLinks: number;
  /** Whether a live humanity attestation is required */
  requireHumanity: boolean;
  /** Minimum live vouches from distinct vouchers (spec §3.1 default floor: 3) */
  minVouches: number;
};

export const DEFAULT_POLICY: Policy = {
  requiredAnswers: [],
  minLinks: 1,
  requireHumanity: false,
  minVouches: 3,
};

export type Profile = {
  handle: string;
  identity?: Verification;
  answers: {
    domain: string;
    name: string;
    answer: string | null;
    status: "active" | "inactive";
    expiresAt: string | null;
  }[];
  links: Verification["links"];
  humanity: Verification["humanity"];
  vouches: Vouch[];
  wallet: string | null;
  checks: Check[];
  complete: boolean;
  warning: string;
};

/**
 * Fold the per-name verifications into one candidate page and grade it against a policy.
 * Pure: every claim on the page traces to a resolver read the API made.
 */
export function assessProfile(
  handle: string,
  results: { instanceDomain: string; name: string; v: Verification | null }[],
  policy: Policy = DEFAULT_POLICY,
  vouches: Vouch[] = []
): Profile {
  const root = results[0]?.v ?? undefined;
  const identity = root && root.status === "active" ? root : undefined;
  const answers = results.slice(1).map((r) => ({
    domain: r.instanceDomain,
    name: r.name,
    answer: r.v?.answer ?? null,
    status: r.v?.status ?? ("inactive" as const),
    expiresAt: r.v?.expiresAt ?? null,
  }));
  const links = identity?.links ?? [];
  const humanity = identity?.humanity ?? null;

  const checks: Check[] = [
    {
      id: "identity",
      label: "Claimed name",
      ok: !!identity,
      detail: identity
        ? `${root!.name} → ${identity.wallet}`
        : `${handle}.${results[0]?.name.split(".").slice(1).join(".") ?? ""} has no live record`,
    },
    {
      id: "links",
      label: `Linked accounts (≥${policy.minLinks})`,
      ok: links.length >= policy.minLinks,
      detail: links.length
        ? links.map((l) => `${l.domain}${l.optedIn ? " (masked)" : ""}`).join(", ")
        : "none",
    },
    ...policy.requiredAnswers.map((d) => {
      const a = answers.find((x) => x.domain === d);
      const ok = !!a && a.status === "active" && !!a.answer;
      return {
        id: `answer:${d}`,
        label: `Answered ${d}`,
        ok,
        detail: ok ? `"${a!.answer}"` : "no live answer",
      };
    }),
  ];
  const liveVouchers = new Set(vouches.filter((v) => v.live).map((v) => v.voucher));
  checks.push({
    id: "vouches",
    label: `Vouches (≥${policy.minVouches})`,
    ok: liveVouchers.size >= policy.minVouches,
    detail: liveVouchers.size ? `${liveVouchers.size} live: ${[...liveVouchers].join(", ")}` : "none yet",
  });
  if (policy.requireHumanity) {
    checks.push({
      id: "humanity",
      label: "Humanity attestation",
      ok: !!humanity,
      detail: humanity ? `level ${humanity.level}` : "not attested",
    });
  }

  return {
    handle,
    identity,
    answers,
    links,
    humanity,
    vouches,
    wallet: identity?.wallet ?? null,
    checks,
    complete: checks.every((c) => c.ok),
    warning:
      root?.warning ??
      "This is not identity, employment, safety, malware, nationality, or affiliation verification.",
  };
}

/** The line a candidate pastes into a cold email. */
export function shareSnippet(handle: string, siteUrl: string, rootParent: string): string {
  return `Verify me at Ketsuban: ${siteUrl.replace(/\/$/, "")}/p/${handle} — on-chain name ${handle}.${rootParent}`;
}

export const HANDLE_RE = /^[a-z0-9-]{1,31}$/;

/** Verifier policy from a query string; defaults require every subject instance answered. */
export function policyFromQuery(q: Record<string, string | undefined>, subjectDomains: string[]): Policy {
  return {
    requiredAnswers: q.answers === undefined ? subjectDomains : q.answers.split(",").filter(Boolean),
    minLinks: q.minLinks !== undefined && /^\d+$/.test(q.minLinks) ? Number(q.minLinks) : 1,
    requireHumanity: q.humanity === "1",
    minVouches:
      q.minVouches !== undefined && /^\d+$/.test(q.minVouches)
        ? Number(q.minVouches)
        : DEFAULT_POLICY.minVouches,
  };
}

/** Reference page link that unmasks one platform link for whoever holds it. */
export function disclosureLink(siteUrl: string, handle: string, domain: string, viewCode: string): string {
  const q = new URLSearchParams({ links: domain, viewCode });
  return `${siteUrl.replace(/\/$/, "")}/p/${handle}?${q.toString()}`;
}
