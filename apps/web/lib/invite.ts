import { parseRequirement, platformOf } from "@ketsuban/registrar";
import type { ConnectedAccount } from "@/lib/identity";
import { UNLINKABLE_PLATFORMS } from "@/lib/platforms";

/**
 * Whether an invitation could ever be satisfied.
 *
 * An invitation asks the writer to have attested accounts, and the attester checks that by looking for
 * a record the writer holds **in that domain**. So a requirement is only ever a domain: a username has
 * no record of its own, and neither has a name in this deployment. Either one is accepted by a free
 * text field, signed into the invitation, and then can never be met — the writer follows the link,
 * vouches, and the reference comes back unsolicited with nothing saying why.
 *
 * Observed: an invitation asking for `github.com, lamtrinh259`, where the handle made the whole
 * invitation impossible even for a writer who had linked GitHub.
 */
export function whyUnsatisfiable(entry: string, parentNames: readonly string[] = []): string | null {
  const { domain: want, handle } = parseRequirement(entry);
  if (!want) return null;
  // `github.com/lam` names one account; the handle has to be one a platform could have issued.
  if (handle !== undefined && !/^[a-z0-9_.-]{1,63}$/.test(handle)) {
    return `“${handle}” is not a handle anybody could hold on ${want}.`;
  }
  if (!want.includes(".")) {
    return `“${want}” is a username, not a domain. Ask for the platform itself, and the writer's own account there is what gets attested.`;
  }
  const platform = platformOf(want);
  if (platform && UNLINKABLE_PLATFORMS.has(platform)) {
    return `“${want}” cannot be linked here: Telegram is not enabled on this deployment, so nobody could attest an account there.`;
  }
  const mine = (parentNames ?? []).find(
    (p) => want === p.toLowerCase() || want.endsWith(`.${p.toLowerCase()}`)
  );
  if (mine) {
    return `“${want}” is a name in this deployment, not a mail host. An invitation asks what the writer has attested elsewhere.`;
  }
  return null;
}

/**
 * What an invitation asks for that the writer has not attested yet.
 *
 * Only requirements somebody could actually meet: one that can never be held is not something to send
 * a writer away to do, and blocking on it would trap them. A masked record counts — it proves an
 * account in that domain without naming it — so the question is answered without publishing which
 * account it is.
 */
export function missingRequirements(
  requires: readonly string[],
  attested: readonly string[],
  parentNames: readonly string[] = []
): string[] {
  const held = new Set(attested.map((d) => d.toLowerCase()));
  return requires.filter((d) => !whyUnsatisfiable(d, parentNames) && !held.has(parseRequirement(d).domain));
}

/**
 * A requirement naming one account (`github.com/lam`) that this writer is not signed in as. Nothing
 * to link fixes it: the invitation was for somebody else, and the page says so instead of sending
 * them to attest an account that will never count.
 */
export function wrongAccount(entry: string, accounts: readonly ConnectedAccount[]): string | null {
  const { domain, handle } = parseRequirement(entry);
  if (!handle) return null;
  const platform = platformOf(domain);
  if (!platform) return null;
  const mine = accounts.filter((a) =>
    platform === "email"
      ? (a.domain === "email" || a.domain === "google") && a.label.toLowerCase().endsWith(`@${domain}`)
      : a.domain === platform
  );
  const held = mine.some((a) => localLabel(a.label) === handle);
  if (held) return null;
  const signedInAs = mine.map((a) => `@${localLabel(a.label)}`).join(", ");
  return `This invitation is for @${handle} on ${domain}${signedInAs ? `; the account linked here is ${signedInAs}` : ", and no account there is linked here"}.`;
}

/** The handle a linked account goes by, as a requirement would name it */
function localLabel(label: string): string {
  return label.replace(/^@/, "").split("#")[0].split("@")[0].toLowerCase();
}

/** `github.com/lam` said for a person: the domain, then who on it */
export function describeRequirement(entry: string): string {
  const { domain, handle } = parseRequirement(entry);
  return handle ? `${domain} as @${handle}` : domain;
}
