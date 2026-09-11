import { matchesAudienceName, WITHDRAWN } from "@ketsuban/registrar";
import type { Verification, Vouch } from "./api";
import type { WebConfig } from "./config";
import { questionTitle } from "./questions";

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
  /**
   * Who the reference has to be from.
   *
   * A count says how many people spoke; it never says who. A verifier who only cares about somebody
   * from one company, or one named person, could not express that and had to read the list by eye.
   * Each entry is a name (`bob.ketsuban.eth`) or a branch (`*.acme.com`), matched the way a disclosure
   * audience is — one syntax for "this person, or anyone in there", not two.
   */
  from?: string[];
  /**
   * Count only references the candidate asked for. Off by default: anyone may refer anyone, and
   * discounting the uninvited by default would put the old permission rule back in through the policy.
   */
  onlySolicited?: boolean;
};

export const DEFAULT_POLICY: Policy = {
  requiredAnswers: [],
  minLinks: 1,
  requireHumanity: false,
  minVouches: 3,
};

export type PolicyPreset = {
  id: string;
  label: string;
  blurb: string;
  policy: Omit<Policy, "requiredAnswers"> & { allSubjects: boolean };
};

/** Ready-made verifier policies; `allSubjects` requires every subject instance answered. */
export const POLICY_PRESETS: PolicyPreset[] = [
  {
    id: "hiring",
    label: "Hiring",
    blurb: "Every subject answered, one linked account, three live references.",
    policy: { allSubjects: true, minLinks: 1, requireHumanity: false, minVouches: 3 },
  },
  {
    id: "landlord",
    label: "Landlord",
    blurb: "Identity and one reference; no opinions asked.",
    policy: { allSubjects: false, minLinks: 1, requireHumanity: false, minVouches: 1 },
  },
  {
    id: "dao",
    label: "DAO membership",
    blurb: "Proof of unique humanity, two references, subjects answered, no links required.",
    policy: { allSubjects: true, minLinks: 0, requireHumanity: true, minVouches: 2 },
  },
  {
    id: "open",
    label: "Just look",
    blurb: "No requirements — read the page as it is.",
    policy: { allSubjects: false, minLinks: 0, requireHumanity: false, minVouches: 0 },
  },
];

export function presetPolicy(preset: PolicyPreset, subjectDomains: string[]): Policy {
  const { allSubjects, ...rest } = preset.policy;
  // Explicit, so every policy has the same shape whether it came from a preset or a query string.
  return { requiredAnswers: allSubjects ? subjectDomains : [], onlySolicited: false, ...rest };
}

/** Query string for a policy: the reference page reads it back with `policyFromQuery`. */
export function policyToQuery(policy: Policy, presetId?: string): string {
  const q = new URLSearchParams({
    answers: policy.requiredAnswers.join(","),
    minLinks: String(policy.minLinks),
    minVouches: String(policy.minVouches),
  });
  if (policy.from?.length) q.set("from", policy.from.join(","));
  if (policy.requireHumanity) q.set("humanity", "1");
  if (policy.onlySolicited) q.set("solicited", "1");
  if (presetId) q.set("preset", presetId);
  return q.toString();
}

/** One-line description of what a policy demands, for the verifier's own sanity. */
export function describePolicy(policy: Policy): string {
  const parts = [
    policy.requiredAnswers.length
      ? `answers for ${policy.requiredAnswers.map(questionTitle).join(", ")}`
      : "no answers required",
    `≥${policy.minLinks} linked account${policy.minLinks === 1 ? "" : "s"}`,
    `≥${policy.minVouches} live reference${policy.minVouches === 1 ? "" : "s"}`,
  ];
  if (policy.onlySolicited) parts.push("only references they asked for");
  if (policy.requireHumanity) parts.push("humanity attested");
  return parts.join(" · ");
}

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
        // The id joins on the domain; the label is the half a person reads.
        label: `Answered ${questionTitle(d)}`,
        ok,
        detail: ok ? `"${a!.answer}"` : "no live answer",
      };
    }),
  ];
  // A withdrawn statement is still a record; it is not a reference any more, so it does not count.
  const counted = vouches
    .filter((v) => v.live && v.statement !== WITHDRAWN)
    .filter((v) => !policy.onlySolicited || v.solicited);
  const liveVouchers = new Set(counted.map((v) => v.voucher));
  checks.push({
    id: "vouches",
    label: `Vouches (≥${policy.minVouches}${policy.onlySolicited ? ", solicited only" : ""})`,
    ok: liveVouchers.size >= policy.minVouches,
    detail: liveVouchers.size
      ? `${liveVouchers.size} live${policy.onlySolicited ? " solicited" : ""}: ${[...liveVouchers].join(", ")}`
      : policy.onlySolicited
        ? "none the candidate asked for"
        : "none yet",
  });
  const wanted = policy.from?.filter((f) => f.trim()) ?? [];
  if (wanted.length) {
    // A voucher is known by the name they signed as; an unclaimed one has only a handle to match on.
    const matched = counted.filter((v) =>
      wanted.some((want) => matchesAudienceName(want, v.voucherName ?? undefined) || want === v.voucher)
    );
    checks.push({
      id: "from",
      label: `Referred by ${wanted.join(" or ")}`,
      ok: matched.length > 0,
      detail: matched.length
        ? matched.map((v) => v.voucherName ?? v.voucher).join(", ")
        : "nobody matching has written one",
    });
  }
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

/** Verifier policy from a query string; `preset` wins, otherwise defaults require every subject answered. */
export function policyFromQuery(q: Record<string, string | undefined>, subjectDomains: string[]): Policy {
  const preset = q.preset ? POLICY_PRESETS.find((p) => p.id === q.preset) : undefined;
  if (preset) return presetPolicy(preset, subjectDomains);
  return {
    requiredAnswers: q.answers === undefined ? subjectDomains : q.answers.split(",").filter(Boolean),
    minLinks: q.minLinks !== undefined && /^\d+$/.test(q.minLinks) ? Number(q.minLinks) : 1,
    requireHumanity: q.humanity === "1",
    onlySolicited: q.solicited === "1",
    from: q.from ? q.from.split(",").filter(Boolean) : undefined,
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

/** The message a candidate pastes to someone they ask for a reference. */
export function vouchRequest(
  handle: string,
  siteUrl: string,
  rootParent: string,
  /** The invitation being sent, when there is one: its link, and what it asks the writer to connect */
  invite?: { code: string; requires: readonly string[] }
): string {
  const base = siteUrl.replace(/\/$/, "");
  const link = invite ? `${base}/vouch/${handle}?invite=${invite.code}` : `${base}/vouch/${handle}`;
  // A message that omits the requirement sends someone to a page where their reference quietly comes
  // out unsolicited; the requirement is enforced either way, so it belongs in the ask.
  const asks = invite?.requires.length
    ? ` Please connect ${invite.requires.join(" and ")} first, so it counts as one I asked for.`
    : "";
  return `Could you vouch for me? It takes five minutes and lands as your own permanent name: ${link} (my page: ${handle}.${rootParent})${asks}`;
}

/**
 * A website as a browser will read it.
 *
 * `url` is a text record and a record is permanent. Typed without a scheme — `example.com`, which is
 * how people write a website down — a browser reads it as a path on whatever page the link sits on,
 * so the record names a page of this site that does not exist and always will. Anything already
 * carrying a scheme is left exactly as typed, including one this app would not have chosen.
 */
export function normalUrl(input: string): string {
  const url = input.trim();
  if (!url || /^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  // A host has a dot and no spaces. Anything else is not a website yet, so it is left to be read back.
  return /^[^\s/]+\.[^\s/]+/.test(url) ? `https://${url}` : url;
}

export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Where a verifier's input should take them. A handle reads as a candidate page; a wallet address is
 * the other way people arrive — from a transaction, a signature or a CV — and needs the wallet page.
 */
export function lookupTarget(
  input: string,
  policyQuery = ""
): { kind: "handle" | "wallet"; href: string } | undefined {
  const text = input.trim();
  if (ADDRESS_RE.test(text)) return { kind: "wallet", href: `/w/${text}` };
  // `0x…` that is not an address is a mistyped address, not a handle called "0xnothex".
  if (text.toLowerCase().startsWith("0x")) return undefined;
  const handle = text
    .toLowerCase()
    .replace(/\.eth$/, "")
    .split(".")[0];
  if (!HANDLE_RE.test(handle)) return undefined;
  return { kind: "handle", href: policyQuery ? `/p/${handle}?${policyQuery}` : `/p/${handle}` };
}
