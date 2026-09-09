import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/unit/**/*.test.ts"],
    // A runner with two cores deadlocked the worker pool here while the same files pass in seconds
    // locally; one file at a time costs a second and never hangs.
    fileParallelism: !process.env.CI,
    coverage: { provider: "v8", include: ["src/**/*.ts"], exclude: ["src/server.ts", "src/chain.ts", "src/abi.ts"], thresholds: { lines: 90, functions: 90, branches: 85 } },
  },
});
