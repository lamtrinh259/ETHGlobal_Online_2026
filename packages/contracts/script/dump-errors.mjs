#!/usr/bin/env node
/**
 * Collect every custom error from the compiled artifacts into one ABI fragment.
 *
 * viem only decodes a revert it can find in the ABI it was given, so a selector like `0xd1cc1202`
 * reaches the user whenever the failing error belongs to a contract further down the call — Multipass,
 * the resolver, OpenZeppelin. Merging this file into any ABI makes every one of them decodable, in the
 * API and in the browser alike.
 *
 *   node script/dump-errors.mjs   # after `forge build`
 */
import { readFileSync, readdirSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

const OUT = "out";
const TARGET = "abi/errors.json";

function walk(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, found);
    else if (entry.endsWith(".json")) found.push(path);
  }
  return found;
}

const byKey = new Map();
for (const file of walk(OUT)) {
  let artifact;
  try {
    artifact = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    continue;
  }
  for (const item of artifact.abi ?? []) {
    if (item.type !== "error") continue;
    const key = `${item.name}(${(item.inputs ?? []).map((i) => i.type).join(",")})`;
    if (!byKey.has(key)) byKey.set(key, item);
  }
}

const errors = [...byKey.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, item]) => item);
writeFileSync(TARGET, `${JSON.stringify(errors, null, 2)}\n`);
console.log(`${TARGET}: ${errors.length} errors`);
