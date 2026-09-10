import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * The checks that need a running deployment.
 *
 * Standalone rather than merged with the default config: merging concatenates `include`, which would
 * drag the whole unit suite into a node environment with no setup. Kept out of the default run rather
 * than merely named differently, because a suite that fails when a server is down is a suite people
 * learn to ignore — and then it stops reporting the drift it exists to find.
 *
 *   pnpm --filter @ketsuban/web check:live
 *   CHECK_API=http://127.0.0.1:8787 pnpm --filter @ketsuban/web check:live
 */
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  test: { include: ["live/**/*.live.ts"], environment: "node" },
});
