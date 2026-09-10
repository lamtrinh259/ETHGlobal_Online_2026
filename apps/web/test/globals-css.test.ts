import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * One rule per selector.
 *
 * A class declared twice does not announce itself: the later rule quietly wins on whatever they share,
 * and the earlier one keeps looking authoritative. `.badge` was declared three hundred lines apart and
 * disagreed about size, padding and colour, so tuning the first changed nothing on the page — the kind
 * of thing that is only ever found by someone wondering why their edit did nothing.
 */
// vitest runs from the package root, and a file URL through its transform does not resolve here.
const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

/** Top-level single-class rules, which are the ones that shadow each other silently. */
function duplicateSelectors(text: string): string[] {
  const seen = new Map<string, number>();
  for (const line of text.split("\n")) {
    const m = /^(\.[a-zA-Z][a-zA-Z0-9_-]*)\s*\{$/.exec(line);
    if (m) seen.set(m[1], (seen.get(m[1]) ?? 0) + 1);
  }
  return [...seen.entries()].filter(([, n]) => n > 1).map(([sel]) => sel);
}

describe("the stylesheet", () => {
  it("declares each class once, so an edit lands where it is made", () => {
    expect(duplicateSelectors(css)).toEqual([]);
  });

  it("notices a class declared twice", () => {
    // The check has to be able to fail, or it is decoration.
    expect(duplicateSelectors(".a {\n  color: red;\n}\n.b {\n}\n.a {\n  color: blue;\n}\n")).toEqual([".a"]);
  });
});
