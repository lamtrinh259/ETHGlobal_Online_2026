// Small presentational helpers. Pure functions, no deps.

/** Per-character animation delays for the wave wordmark. */
export function waveChars(word: string): { ch: string; delay: string }[] {
  return [...word].map((ch, i) => ({ ch, delay: `${i * 70}ms` }));
}

/** Short 0x1234…abcd form for addresses and hashes. */
export function short(hex: string, head = 6, tail = 4): string {
  if (!hex || hex.length <= head + tail + 2) return hex;
  return `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}

/** UTC date-time without seconds, for expiries. */
export function fmtUtc(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 16).replace("T", " ") + "Z";
}

/**
 * What the footer says about this build. Two facts, either of which can be missing: the commit (absent
 * in a gitless build context) and the time (always present). A deploy is identified by the pair, so a
 * screenshot of a bug names the code that produced it.
 */
export function buildStamp(sha?: string, time?: string): string {
  const parts = [sha?.trim(), time?.trim()].filter((p): p is string => !!p);
  return parts.length ? `build ${parts.join(" · ")}` : "build unknown";
}
