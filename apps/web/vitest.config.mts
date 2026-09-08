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
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts", "app/VerifyCard.tsx", "app/ui.ts"],
      thresholds: { lines: 90, functions: 90, branches: 80 },
    },
  },
});
