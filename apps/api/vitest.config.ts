import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/unit/**/*.test.ts"],
    coverage: { provider: "v8", include: ["src/**/*.ts"], exclude: ["src/server.ts", "src/chain.ts", "src/abi.ts"], thresholds: { lines: 90, functions: 90, branches: 85 } },
  },
});
