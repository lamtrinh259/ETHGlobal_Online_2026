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
