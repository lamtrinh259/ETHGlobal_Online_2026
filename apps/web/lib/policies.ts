import type { Policy } from "./profile";

/**
 * A verifier's own policies, kept in their browser.
 *
 * The presets are what the platform ships — a starting point, and the same for everybody. What a
 * verifier actually checks is theirs: a hiring bar, a landlord's, one company's rule about who has to
 * have referred. Rebuilding it every time meant the fields drifted between one candidate and the next,
 * which is the one thing a policy is supposed to stop.
 *
 * Local, because it is nobody else's business what somebody's bar is, and it belongs to the person
 * reading rather than to any deployment.
 */
const KEY = "ketsuban:policies";

export type SavedPolicy = { name: string; policy: Policy };

export function loadPolicies(): SavedPolicy[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? (raw.filter((p) => p && typeof p === "object") as SavedPolicy[]) : [];
  } catch {
    // A browser that refuses storage, or something else's key: neither is worth breaking the page for.
    return [];
  }
}

/** Saving under a name that already exists replaces it, which is what editing one looks like. */
export function savePolicy(entry: SavedPolicy): SavedPolicy[] {
  const kept = loadPolicies().filter((p) => p.name !== entry.name);
  const all = [...kept, entry];
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Storage can be full or refused; the policy still applies to this check.
  }
  return all;
}

export function forgetPolicy(name: string): SavedPolicy[] {
  const all = loadPolicies().filter((p) => p.name !== name);
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // As above: the list on screen is what the caller renders either way.
  }
  return all;
}
