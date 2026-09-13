/**
 * Preview deployments, addressed by the pull request that made them.
 *
 * Coolify serves a preview at `{{pr_id}}.{{domain}}` and tells the container so through
 * `COOLIFY_FQDN` (`1.shibboleth.peeramid.xyz`) or `COOLIFY_URL` (with the scheme). The web app and the
 * API are two such deployments of one pull request, and each is configured with the other's
 * production address — so the preview id in front of its own host has to be put in front of the
 * other's too, or the preview web app talks to the production API and the production API refuses
 * the preview origin. One rule, read by both sides.
 */

/** The pull request a preview host serves, or nothing where the host is not a preview. */
export function previewId(fqdn: string | undefined): string | undefined {
  if (!fqdn) return undefined;
  const host = fqdn
    .trim()
    .replace(/^[a-z]+:\/\//i, "")
    .replace(/[/:].*$/, "");
  const first = host.split(".")[0];
  // A number, and a host beneath it: `1.shibboleth.peeramid.xyz`, never `1` alone.
  return /^\d+$/.test(first) && host.includes(".") ? first : undefined;
}

/**
 * The same URL, addressed to the preview that `fqdn` belongs to.
 *
 * `https://shibboleth-api.peeramid.xyz` beside `1.shibboleth.peeramid.xyz` is
 * `https://1.shibboleth-api.peeramid.xyz`. Unchanged where there is no preview, where the URL already
 * carries that id, or where it is not a URL at all — a wrong address is worse than the production one.
 */
export function forPreview(url: string, fqdn: string | undefined): string {
  const id = previewId(fqdn);
  if (!id) return url;
  // Taken apart by hand: this also runs where `URL` does not exist (the CRE runtime).
  const m = /^([a-z][a-z0-9+.-]*:\/\/)([^/:?#]+)(.*)$/i.exec(url.trim());
  if (!m) return url;
  const [, scheme, host, rest] = m;
  if (host.split(".")[0] === id) return url;
  return `${scheme}${id}.${host}${rest}`;
}
