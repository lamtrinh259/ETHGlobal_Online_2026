import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { VOLATILE_WITHOUT_DATA_DIR } from "../../src/store.js";

/**
 * The same warning is emitted twice — once at boot, once from preflight — and the two had drifted:
 * one named three of the stores under `DATA_DIR` and the other five. An operator reads whichever they
 * happen to hit, so the sentence is kept in one place and this refuses a second copy of it.
 */
const SRC = join(import.meta.dirname, "../../src");

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sources(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : []
  );

describe("what a deployment without DATA_DIR is told it loses", () => {
  it("names every store that actually lives there", () => {
    for (const store of [/letter/i, /permission/i, /invitation/i, /one-human-one-account/i, /gas top-up/i]) {
      expect(VOLATILE_WITHOUT_DATA_DIR, String(store)).toMatch(store);
    }
  });

  it("is written once, so the boot line and preflight cannot disagree", () => {
    const copies = sources(SRC).filter(
      (f) => !f.endsWith("store.ts") && readFileSync(f, "utf8").includes("lost on restart")
    );
    expect(copies, "these spell the warning out instead of importing it").toEqual([]);
  });
});
