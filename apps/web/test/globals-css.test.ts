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

/**
 * A rule for a class nothing renders is shipped to every visitor and read by nobody. They are left
 * behind by a component that was removed, or by a rename that only touched the markup — the sybil
 * block outlived its component by a day, and the avatar placeholder outlived the profile card it
 * belonged to.
 *
 * Names built at runtime (`dash-${state}`) cannot be found this way, so they are listed rather than
 * guessed at: a check that quietly ignores what it cannot see would be worse than none.
 */
describe("rules nothing uses", () => {
  /** Composed at runtime from a value, so no file contains the whole class name. */
  const dynamic = new Set(["dash-done", "dash-now", "dash-pending", "dash-todo"]);

  it("ships none", async () => {
    const { readdirSync, readFileSync: read } = await import("node:fs");
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".tsx") ? [join(dir, e.name)] : []
      );
    const markup = walk(join(process.cwd(), "app"))
      .map((f) => read(f, "utf8"))
      .join("\n");

    const declared = [...css.matchAll(/^\.([a-zA-Z][a-zA-Z0-9_-]*)/gm)].map((m) => m[1]);
    const unused = [...new Set(declared)].filter(
      (c) => !dynamic.has(c) && !new RegExp(`\\b${c}\\b`).test(markup)
    );
    expect(unused).toEqual([]);
  });
});

/**
 * There is no global list reset in this stylesheet, so a `ul` whose class styles nothing keeps its
 * bullets and its indent. `/names` shipped card-shaped items down a bulleted list that way, on a page
 * linked from the nav and from the front page — the defect a class name that styles nothing can cause
 * when the element it is on has defaults of its own.
 */
describe("lists that are lists only structurally", () => {
  it("every ul with a class has a rule that resets it", async () => {
    const { readdirSync, readFileSync: read } = await import("node:fs");
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".tsx") ? [join(dir, e.name)] : []
      );
    const markup = walk(join(process.cwd(), "app"))
      .map((f) => read(f, "utf8"))
      .join("\n");

    const classed = [...markup.matchAll(/<ul className="([^"]+)"/g)].map((m) => m[1].split(" ")[0]);
    const unreset = [...new Set(classed)].filter((c) => {
      // The rule may be grouped with others, so look at the whole block a selector opens.
      const block = new RegExp(`(^|,\\s*)\\.${c}\\s*(,[^{]*)?\\{[^}]*\\}`, "m").exec(css);
      return !block || !/list-style:\s*none/.test(block[0]);
    });
    expect(unreset).toEqual([]);
  });
});

/**
 * A custom property that was never defined resolves to its fallback, silently. That is fine when the
 * fallback is what was wanted and wrong when the name implied a theme token: the hole in the score
 * ring named one that does not exist and fell back to white, which is right in the light theme and a
 * white disc on a dark card in the default one.
 */
describe("custom properties", () => {
  /** Set inline by a component, so the stylesheet cannot define it. */
  const inline = new Set(["--pct"]);

  it("are defined wherever they are read", () => {
    const defined = new Set([...css.matchAll(/^\s*(--[a-zA-Z0-9-]+):/gm)].map((m) => m[1]));
    const used = new Set([...css.matchAll(/var\((--[a-zA-Z0-9-]+)/g)].map((m) => m[1]));
    const missing = [...used].filter((v) => !defined.has(v) && !inline.has(v));
    expect(missing).toEqual([]);
  });

  it("notices one that is only ever read", () => {
    // The check has to be able to fail, or it is decoration.
    const sample = ":root {\n  --a: red;\n}\n.x {\n  color: var(--b, blue);\n}\n";
    const defined = new Set([...sample.matchAll(/^\s*(--[a-zA-Z0-9-]+):/gm)].map((m) => m[1]));
    const used = new Set([...sample.matchAll(/var\((--[a-zA-Z0-9-]+)/g)].map((m) => m[1]));
    expect([...used].filter((v) => !defined.has(v))).toEqual(["--b"]);
  });
});

/**
 * Text has to be readable on the surface behind it, in both themes.
 *
 * One colour usually cannot do both: the unsolicited badge was a fixed amber that reached 4.9:1 on
 * white and 3.8:1 on the dark panel — below the 4.5:1 that WCAG AA asks of body text, on the theme
 * this deployment shows by default. A value that is right in the theme somebody happens to be
 * developing in is how that survives review.
 */
describe("text on the surface behind it", () => {
  const channel = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = (hex: string) => {
    const h = hex.replace("#", "");
    const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
    const [r, g, b] = [0, 2, 4].map((i) => channel(parseInt(full.slice(i, i + 2), 16) / 255));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  /** The value a token holds in a given block, read from the stylesheet rather than restated here. */
  const tokenIn = (block: RegExp, name: string) => {
    const found = block.exec(css);
    if (!found) throw new Error(`no such palette block`);
    const m = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{3,8})`).exec(found[0]);
    if (!m) throw new Error(`${name} is not set in that palette`);
    return m[1];
  };

  const DARK = /^:root \{[^}]*\}/m;
  const LIGHT = /^:root\[data-theme="light"\] \{[^}]*\}/m;

  it("reads the warning colour on the panel of either theme", () => {
    expect(contrast(tokenIn(DARK, "--warning"), tokenIn(DARK, "--panel"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tokenIn(LIGHT, "--warning"), tokenIn(LIGHT, "--panel"))).toBeGreaterThanOrEqual(4.5);
  });

  it("measures contrast the way the standard defines it", () => {
    // Black on white is the maximum, and a colour against itself is the minimum.
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrast("#123456", "#123456")).toBeCloseTo(1, 5);
  });
});
