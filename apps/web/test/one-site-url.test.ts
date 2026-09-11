import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Where this deployment is served from, read in one place.
 *
 * It was read in three, each with a fallback of its own: a social card pointing at localhost, a share
 * snippet with no origin at all, and a secure-context answer of "no" that changed which avatars a page
 * would render. A deployment that forgets the variable degraded three ways at once and none of them
 * showed up in the app, which is what a fallback per caller buys.
 */
const ROOT = join(import.meta.dirname, "..");

function sourcesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourcesUnder(path));
    else if (/\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

describe("the site URL", () => {
  it("is read by the config and by nothing else", () => {
    const readers = [...sourcesUnder(join(ROOT, "app")), ...sourcesUnder(join(ROOT, "lib"))]
      .filter((f) => readFileSync(f, "utf8").includes("NEXT_PUBLIC_SITE_URL"))
      .map((f) => f.slice(ROOT.length + 1));
    expect(readers, "read it through `siteUrl()` instead").toEqual(["lib/config.ts"]);
  });
});
