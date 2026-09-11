/**
 * The people one reader is checking, kept in their browser.
 *
 * An employer does not check one candidate; they check a list of them against one bar, and want to
 * know which of them clears it without opening each page in turn. Who somebody is considering is
 * theirs — it says as much about them as about the candidates — so it stays where their policies do
 * rather than on any deployment.
 */
const KEY = "ketsuban:shortlist";

export type Shortlisted = {
  handle: string;
  /** What the reader is checking them for, in their own words */
  note?: string;
  addedAt: string;
};

export function loadShortlist(): Shortlisted[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(raw)
      ? (raw.filter(
          (x) => x && typeof x === "object" && typeof (x as Shortlisted).handle === "string"
        ) as Shortlisted[])
      : [];
  } catch {
    // A browser that refuses storage, or something else's key under the same name.
    return [];
  }
}

/** Adding somebody already on the list moves nothing: the same person twice is not two candidates. */
export function shortlist(handle: string, note?: string): Shortlisted[] {
  const key = handle.trim().toLowerCase();
  if (!key) return loadShortlist();
  const kept = loadShortlist().filter((s) => s.handle !== key);
  const all = [{ handle: key, note: note?.trim() || undefined, addedAt: new Date().toISOString() }, ...kept];
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Storage can be full or refused; the row still renders for this session.
  }
  return all;
}

export function unshortlist(handle: string): Shortlisted[] {
  const all = loadShortlist().filter((s) => s.handle !== handle.trim().toLowerCase());
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // As above.
  }
  return all;
}
