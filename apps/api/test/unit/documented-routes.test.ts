import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The endpoint table is what somebody integrating reads instead of the source, and a third of the
 * routes had never reached it — the search the app itself calls, the whole invitation flow, letters.
 * A route nobody wrote down is a route nobody outside this repo can use.
 */
const ROOT = join(import.meta.dirname, "../..");
const source = readFileSync(join(ROOT, "src/app.ts"), "utf8");
const readme = readFileSync(join(ROOT, "README.md"), "utf8");

/** `/v1/name/:domain/:handle` and `/v1/name/:a/:b` are the same route written two ways. */
const shape = (verb: string, path: string) => `${verb.toUpperCase()} ${path.replace(/:[A-Za-z]+/g, ":x")}`;

const routes = [...source.matchAll(/app\.(get|post|delete|put)\(\s*"([^"]+)"/g)].map((m) =>
  shape(m[1], m[2])
);

const documented = new Set(
  [...readme.matchAll(/`((?:GET|POST|DELETE|PUT) \/[^`?\s]+)/g)].map((m) => {
    const [verb, path] = m[1].split(" ");
    return shape(verb, path);
  })
);

describe("the endpoint table", () => {
  it("has a row for every route the service answers", () => {
    const missing = [...new Set(routes)].filter((r) => !documented.has(r)).sort();
    expect(missing, "add these to apps/api/README.md").toEqual([]);
  });
});
