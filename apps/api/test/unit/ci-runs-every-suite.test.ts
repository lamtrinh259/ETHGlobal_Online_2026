import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A suite nobody runs is a suite nobody has.
 *
 * The workflow names each package one at a time on purpose — a recursive run that hangs says nothing
 * about which package hung — and that list is written out by hand. A package whose tests arrive after
 * it was written is a package CI never runs, and the tests pass locally forever while proving nothing
 * about what is pushed.
 *
 * This repository has already paid for the general form of that: the docker suite ran on no machine
 * but a developer's for its whole life, and the two assertions that had gone stale in it were found
 * only when it finally started.
 */
const ROOT = join(import.meta.dirname, "../../../..");
const workflow = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");

/** Every workspace package that has something to run, read from the workspace itself. */
function packagesWithTests(): { name: string; scripts: string[] }[] {
  const found: { name: string; scripts: string[] }[] = [];
  for (const group of ["apps", "packages"]) {
    for (const entry of readdirSync(join(ROOT, group), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const here = join(ROOT, group, entry.name);
      const candidates = [
        here,
        ...readdirSync(here, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => join(here, e.name)),
      ];
      for (const dir of candidates) {
        const file = join(dir, "package.json");
        if (!existsSync(file)) continue;
        const pkg = JSON.parse(readFileSync(file, "utf8")) as {
          name?: string;
          scripts?: Record<string, string>;
        };
        const scripts = Object.keys(pkg.scripts ?? {}).filter(
          // A watcher is for somebody sitting in front of it, and never finishes.
          (s) => (s === "test" || s.startsWith("test:")) && !s.includes("watch")
        );
        if (pkg.name && scripts.length) found.push({ name: pkg.name, scripts });
      }
    }
  }
  return found;
}

describe("the workflow", () => {
  for (const { name, scripts } of packagesWithTests()) {
    for (const script of scripts) {
      it(`runs ${name} ${script}`, () => {
        // `pnpm --filter <name> test` and `… run test:e2e` are both how the workflow spells it.
        const spelled = new RegExp(`--filter ${name.replace("/", "\\/")}( run)? ${script}\\b`);
        expect(spelled.test(workflow), `add \`pnpm --filter ${name} ${script}\` to ci.yml`).toBe(true);
      });
    }
  }

  it("finds the packages to ask about, rather than passing because it found none", () => {
    // The check above is vacuous if the walk returns nothing, which is exactly how it would break.
    expect(
      packagesWithTests()
        .map((p) => p.name)
        .sort()
    ).toEqual([
      "@ketsuban/api",
      "@ketsuban/contracts",
      "@ketsuban/cre-attest",
      "@ketsuban/registrar",
      "@ketsuban/web",
    ]);
  });
});
