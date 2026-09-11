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
  const want = entry.trim().toLowerCase();
  if (!want) return null;
  if (!want.includes(".")) {
    return `“${want}” is a username, not a domain. Ask for the platform itself, and the writer's own account there is what gets attested.`;
  }
  const mine = (parentNames ?? []).find(
    (p) => want === p.toLowerCase() || want.endsWith(`.${p.toLowerCase()}`)
  );
  if (mine) {
    return `“${want}” is a name in this deployment, not a mail host. An invitation asks what the writer has attested elsewhere.`;
  }
  return null;
}
