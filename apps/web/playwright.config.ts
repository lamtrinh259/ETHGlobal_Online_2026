import { defineConfig } from "@playwright/test";

// Responsive + flow smoke tests against a prod build with the API mocked via page.route.
// Privy itself is not exercised (no headless wallet); the sign-in gate is asserted as a state.
export default defineConfig({
  testDir: "./e2e",
  timeout: 45000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  workers: 1,
  retries: 1,
  use: { baseURL: "http://127.0.0.1:8099", trace: "off" },
  projects: [
    {
      name: "mobile",
      use: { defaultBrowserType: "chromium", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
    },
    { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: "npm run build && npx next start -p 8099 -H 127.0.0.1",
    env: { TEST_BUILD: "1" },
    url: "http://127.0.0.1:8099/api/health",
    reuseExistingServer: true,
    timeout: 240000,
  },
});
