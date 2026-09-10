#!/usr/bin/env node
/**
 * Copy the deployable artifacts the API needs into `abi/`.
 *
 * A grouping level is a plain contract with no factory behind it, so provisioning a namespace at runtime
 * means deploying one from TypeScript: that needs the bytecode, and `out/` is a build directory nobody
 * ships. This writes exactly the artifacts that are deployed at runtime, ABI and bytecode, nothing else.
 *
 *   node script/dump-artifacts.mjs   # after `forge build`
 */
import { readFileSync, writeFileSync } from "node:fs";

const WANTED = ["GroupingRegistry"];

for (const name of WANTED) {
  const artifact = JSON.parse(readFileSync(`out/${name}.sol/${name}.json`, "utf8"));
  const out = { abi: artifact.abi, bytecode: artifact.bytecode.object };
  if (!out.bytecode?.startsWith("0x")) throw new Error(`${name}: no bytecode in artifact`);
  writeFileSync(`abi/${name}.json`, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`abi/${name}.json`, out.bytecode.length / 2, "bytes");
}
