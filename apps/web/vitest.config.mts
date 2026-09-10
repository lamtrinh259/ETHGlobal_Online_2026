import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    // `live/` is not here on purpose: those hit a running deployment, and a suite that fails when a
    // server is down is a suite people learn to ignore. Run them with `pnpm check:live`.
    include: ["test/**/*.test.{ts,tsx}"],
    // One file at a time on a runner; these files share module mocks, so they cannot share a process.
    fileParallelism: !process.env.CI,
    coverage: {
      provider: "v8",
      // Same as the api: text is what a log shows, and the rest is minutes of writing files.
      reporter: ["text"],
      include: ["lib/**/*.ts", "app/VerifyCard.tsx", "app/ui.ts"],
      thresholds: { lines: 90, functions: 90, branches: 80 },
    },
  },
});
