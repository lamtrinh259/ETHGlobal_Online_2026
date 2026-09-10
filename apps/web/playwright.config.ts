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
  webServer: [
    // The content pages are server components, so their reads never pass through the browser and
    // `page.route` cannot reach them. Without this they all degrade to an error card, and the suite
    // proves the shell fits a phone and nothing about the pages inside it.
    {
      command: "node e2e/mock-api.mjs",
      env: { PORT: "8098" },
      url: "http://127.0.0.1:8098/v1/instances",
      reuseExistingServer: true,
      timeout: 30000,
    },
    {
      command: "npm run build && npx next start -p 8099 -H 127.0.0.1",
      // Inlined at build, so it has to be set here rather than at start.
      env: {
        TEST_BUILD: "1",
        NEXT_PUBLIC_API_URL: "http://127.0.0.1:8098",
        NEXT_PUBLIC_ATTEST_URL: "http://127.0.0.1:8098/v1/attest",
        // Stated here rather than inherited, so the suite builds the same way on a machine that has
        // never had a `.env.local` — which is what CI is.
        NEXT_PUBLIC_CHAIN_ID: "11155111",
        NEXT_PUBLIC_MULTIPASS: "0x418F82fd0014a4CA402F145978bfaF0555a9cA06",
        NEXT_PUBLIC_NAME_DOMAINS: "ketsuban,kju-is",
        NEXT_PUBLIC_PARENT_NAMES: "ketsuban.eth,kju-is.ketsuban.eth",
        NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:8099",
        // Privy is never reached here — no headless wallet — but the config refuses to parse without
        // them, and a page that will not render proves nothing about the page.
        NEXT_PUBLIC_PRIVY_APP_ID: "cmtr2o4p401xc0cjqur64l2m2",
        NEXT_PUBLIC_PRIVY_CLIENT_ID: "client-WY6d7mKRG7hN32uoAWH5CZb3q8LUot5ChpVzVkHFiD2Gz",
      },
      url: "http://127.0.0.1:8099/api/health",
      reuseExistingServer: true,
      timeout: 240000,
    },
  ],
});
