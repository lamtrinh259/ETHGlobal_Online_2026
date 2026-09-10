import { isDnsName } from "./accounts.js";

/**
 * The grouping levels a deployment reserves at its root. A platform account lands under `www` and an
 * email under `@`, because an address is not a handle and the two should not share a namespace. Each
 * has a private mirror holding the accounts someone chose to keep behind a view code.
 */
export const PUBLIC_GROUPINGS = ["www", "@"] as const;
export const PRIVATE_GROUPINGS = ["private-www", "private@"] as const;

export type Grouping = { open: string; masked: string };

export function groupingFor(domain: string): Grouping {
  return domain === "email" ? { open: "@", masked: "private@" } : { open: "www", masked: "private-www" };
}

/**
 * The registries a DNS name mounts through, outermost first: `x.com` under `www` is `www` → `x` → `com`,
 * and the instance itself is the last one. First label first, so a service that hands out subdomains
 * keeps them apart — `tenant.acme.com` is its own chain rather than a level inside `acme.com`.
 */
export function mountPath(dns: string, grouping: string): string[] {
  return [grouping, ...dns.toLowerCase().split(".")];
}

/**
 * The ENS name an attested account answers at, or nothing when it cannot have one. A public account is
 * named by the account (`alice_x.com.x.www.<root>`); a masked one by the person who holds it
 * (`alice.com.x.private-www.<root>`), because the stored name is a one-time pad over the handle.
 */
export function ensNameFor(at: {
  root: string;
  /** Multipass domain the record lives in, which decides the grouping level */
  domain: string;
  dns: string | undefined;
  label: string | undefined;
  optIn: boolean;
}): string | undefined {
  if (!at.dns || !at.label || !isDnsName(at.dns)) return undefined;
  const group = groupingFor(at.domain);
  const path = mountPath(at.dns, at.optIn ? group.masked : group.open);
  return [at.label, ...path.reverse(), at.root].join(".");
}

/** A mount as the factory records it: enough to say what a name under it means. */
export type Mount = { domain: string; parentName: string; maskedParentName?: string };

/** Prefixes marking a per-candidate vouch instance (`~alice`), whose records are references. */
export const DEFAULT_NAME_DOMAIN_PREFIXES: readonly string[] = ["~"];

/**
 * Whether a domain holds names rather than accounts.
 *
 * A deployment configures its root name domains, but every claimed candidate also gets a vouch
 * instance of their own — `~alice`, mounted at `alice.<root>` — which is never in that list and is a
 * name domain all the same. Testing membership alone reads those mounts as platforms.
 */
export function isNameDomain(
  domain: string,
  nameDomains: readonly string[],
  prefixes: readonly string[] = DEFAULT_NAME_DOMAIN_PREFIXES
): boolean {
  if (nameDomains.includes(domain)) return true;
  return prefixes.some((p) => domain.length > p.length && domain.startsWith(p));
}

export type NameClaim = {
  /** What this name says, in a sentence */
  says: string;
  /** The part of the namespace it belongs to, when it belongs to one */
  kind: "person" | "account" | "private" | "reference" | "mount" | "unknown";
  /** The domain it lives in, for an account */
  domain?: string;
  /** The label that varies: a person's handle, an account's handle */
  label?: string;
};

/**
 * What a name would claim, read from the mounts rather than from its shape. A reader pasting a name
 * deserves an answer even when nothing resolves there: "nobody holds this" and "this could never mean
 * anything here" are different facts, and only the mounts can tell them apart.
 */
export function explainName(
  input: string,
  mounts: readonly Mount[],
  nameDomains: readonly string[]
): NameClaim {
  const name = input.trim().toLowerCase().replace(/\.$/, "");
  const root = mounts.find((i) => nameDomains.includes(i.domain));
  if (!name || !root) return { says: "", kind: "unknown" };

  const under = (parent: string) => {
    const suffix = `.${parent.toLowerCase()}`;
    if (!name.endsWith(suffix)) return undefined;
    const rest = name.slice(0, -suffix.length);
    return rest && !rest.includes(".") ? rest : undefined;
  };

  for (const mount of mounts) {
    const open = under(mount.parentName);
    if (open && !isNameDomain(mount.domain, nameDomains)) {
      return {
        says: `${open} is an account at ${mount.domain}, attested in the open by whoever holds it.`,
        kind: "account",
        domain: mount.domain,
        label: open,
      };
    }
    const masked = mount.maskedParentName ? under(mount.maskedParentName) : undefined;
    if (masked) {
      return {
        says: `The person called ${masked} holds an account at ${mount.domain}. Which account stays behind a view code.`,
        kind: "private",
        domain: mount.domain,
        label: masked,
      };
    }
  }

  /*
   * A name that is itself a mount is not a person.
   *
   * A mount hangs one label under the root — `x.<root>` holds the X accounts, `kju-is.<root>` is a
   * subject instance — which is the same shape as a person's name. Reading the shape alone calls
   * those people, and they are names nobody can ever claim: something already answers there.
   */
  // A candidate's vouch instance is mounted at the candidate's own name, so it is the one mount whose
  // parent is a person: `alice.<root>` is Alice, not the place `~alice` hangs.
  const isVouchMount = (d: string) => !nameDomains.includes(d) && isNameDomain(d, nameDomains);
  const mounted = mounts.find(
    (m) =>
      !isVouchMount(m.domain) &&
      (m.parentName.toLowerCase() === name || m.maskedParentName?.toLowerCase() === name)
  );
  if (mounted) {
    const holds = isNameDomain(mounted.domain, nameDomains)
      ? `the names in ${mounted.domain}`
      : `the accounts attested at ${mounted.domain}`;
    return {
      says: `${name} is where this deployment mounts ${holds}. It is not a name a person can hold.`,
      kind: "mount",
      domain: mounted.domain,
    };
  }

  const person = under(root.parentName);
  /*
   * The grouping levels are mounted at the root and hold the platform mounts beneath them, so they are
   * taken in every deployment, whether or not one of their platforms is mounted yet.
   */
  if (person && [...PUBLIC_GROUPINGS, ...PRIVATE_GROUPINGS].some((g) => g === person)) {
    return {
      says: `${person} groups the mounts beneath it rather than naming anybody. It is not a name a person can hold.`,
      kind: "mount",
      label: person,
    };
  }
  if (person) return { says: `${person} is a person's name here.`, kind: "person", label: person };

  // `<voucher>.<candidate>.<root>`: a reference lives in the candidate's own namespace.
  const suffix = `.${root.parentName.toLowerCase()}`;
  if (name.endsWith(suffix)) {
    const rest = name.slice(0, -suffix.length).split(".");
    if (rest.length === 2)
      return {
        // Two labels under the root is the shape of a reference whoever holds them: only a lookup can
        // say whether that candidate exists.
        says: `A reference written for ${rest[1]} by ${rest[0]}, in ${rest[1]}'s own namespace — if ${rest[1]} holds that name.`,
        kind: "reference",
        label: rest[0],
      };
  }
  return {
    says: `Nothing in this deployment answers for ${name}. It ends outside every namespace it holds.`,
    kind: "unknown",
  };
}
