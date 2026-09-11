import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Components nothing renders.
 *
 * The stylesheet already refuses a rule nothing uses, for the reason a component deserves the same:
 * a page gets rearranged, something stops being rendered, and it stays in the tree looking current —
 * read as the way the app works by whoever opens it next. `SignedIn` sat there after the front page
 * became the search, saying "welcome back" on a page nobody saw.
 */
const ROOT = join(import.meta.dirname, "..");

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".tsx") || p.endsWith(".ts") ? [p] : [];
  });

describe("the component tree", () => {
  it("renders everything it carries", () => {
    const files = [...walk(join(ROOT, "app")), ...walk(join(ROOT, "lib"))];
    const source = files.map((f) => readFileSync(f, "utf8")).join("\n");

    const orphans = files
      .filter((f) => !/[/\\](page|layout)\.tsx$/.test(f))
      .flatMap((f) =>
        [...readFileSync(f, "utf8").matchAll(/export function ([A-Z][A-Za-z0-9]*)/g)].map((m) => m[1])
      )
      // Its own declaration is the one mention every component has; a second is somebody using it.
      .filter((name) => source.split(new RegExp(`\\b${name}\\b`)).length - 1 <= 1);

    expect([...new Set(orphans)], "nothing renders these; delete them or render them").toEqual([]);
  });
});
