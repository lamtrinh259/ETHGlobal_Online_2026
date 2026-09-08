import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/e2e/**/*.test.ts"],
    globalSetup: ["test/e2e/global-setup.ts"],
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
});
