import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The route table is what somebody arriving at this app reads instead of the tree.
 *
 * Its rows had gone stale in both directions at once: two pages that no longer exist were still
 * described, two that do exist were missing, and the front page was written up as three doors it has
 * not had for some time. A row for a page nobody can open is worse than no row — it is a map of a
 * building that was demolished.
 *
 * The attester's own table is guarded this way already; this is the same check for the app.
 */
const ROOT = join(import.meta.dirname, "..");
const readme = readFileSync(join(ROOT, "README.md"), "utf8");

/** `app/p/[handle]/page.tsx` is the route `/p/<handle>`, which is how the table writes it. */
function routesUnder(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (entry === "page.tsx") out.push(prefix || "/");
    else if (statSync(path).isDirectory() && !entry.startsWith("_")) {
      // Route groups and the API handlers are not pages anybody navigates to.
      const label = entry.replace(/^\[(.+)\]$/, "<$1>");
      if (entry !== "api") out.push(...routesUnder(path, `${prefix}/${label}`));
    }
  }
  return out;
}

const pages = new Set(routesUnder(join(ROOT, "app")));
const documented = new Set(
  [...readme.matchAll(/^\| `([^`]+)`/gm)].map((m) => m[1]).filter((r) => r.startsWith("/"))
);

describe("the route table", () => {
  it("has a row for every page this app serves", () => {
    const missing = [...pages].filter((r) => !documented.has(r) && r !== "/api/health").sort();
    expect(missing, "add these to apps/web/README.md").toEqual([]);
  });

  it("has no row for a page nobody can open", () => {
    const gone = [...documented].filter((r) => !pages.has(r) && r !== "/api/health").sort();
    expect(gone, "these are described but do not exist").toEqual([]);
  });
});
