import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isAddress } from "viem";

/**
 * Every address this repo ships has to survive being handed to viem.
 *
 * EIP-55 casing is a checksum, and viem refuses an address whose casing does not match its own. A
 * mis-cased address in a deployment file is not caught by any type or schema: it looks like an
 * address everywhere until the moment a call is built, and then it surfaces as a failed read rather
 * than as a configuration error anyone can act on. This is the guard that catches it at rest.
 */
const dir = fileURLToPath(new URL("../../../../packages/contracts/deployments/", import.meta.url));

describe("the deployment files this build ships", () => {
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

  it("names at least one deployment, or this test is proving nothing", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file} carries only addresses viem will accept`, () => {
      const raw = readFileSync(`${dir}${file}`, "utf8");
      const bad: string[] = [];
      for (const [, key, value] of raw.matchAll(/"([A-Za-z][A-Za-z0-9_]*)":\s*"(0x[0-9a-fA-F]{40})"/g)) {
        if (!isAddress(value, { strict: true })) bad.push(`${key}: ${value}`);
      }
      expect(bad).toEqual([]);
    });
  }
});
