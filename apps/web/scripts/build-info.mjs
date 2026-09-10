import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Stamp the build once, into a file both halves read.
 *
 * `next.config.mjs` is evaluated whenever the config is loaded — at build, and again when the server
 * starts — so a timestamp computed there gives the page and the health probe different answers, and a
 * screenshot of a bug then names a build that never existed.
 */
function sha() {
  const fromEnv = (process.env.SOURCE_COMMIT || process.env.GIT_SHA || "").slice(0, 7);
  if (fromEnv) return fromEnv;
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    // a gitless build context, e.g. an image built from an archive
    return "";
  }
}

const info = { sha: sha(), builtAt: `${new Date().toISOString().slice(0, 16).replace("T", " ")}Z` };
const out = fileURLToPath(new URL("../lib/build-info.json", import.meta.url));
writeFileSync(out, `${JSON.stringify(info, null, 2)}\n`);
console.log(`build-info · ${info.sha || "no sha"} · ${info.builtAt}`);
