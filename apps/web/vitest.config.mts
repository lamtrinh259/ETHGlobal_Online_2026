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
    include: ["test/**/*.test.{ts,tsx}"],
    // Same reason as the api: a small runner deadlocks the pool, and these files are fast anyway.
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
