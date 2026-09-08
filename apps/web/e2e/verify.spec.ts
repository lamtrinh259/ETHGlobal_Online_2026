import { test, expect } from "@playwright/test";

// /v/<name> is server-rendered from the API; the API is not reachable in this test, so the page
// must degrade to an error card rather than a crash, and the shell must still frame it.
test("verify page frames an unreachable API as an error card", async ({ page }) => {
  await page.goto("/v/alice.ketsuban.eth");
  await expect(page.getByRole("heading", { name: "alice.ketsuban.eth" })).toBeVisible();
  await expect(page.locator("main [role=alert]")).toHaveText("fetch failed");
  await expect(page.locator(".sh-top")).toBeVisible();
});

test("unknown routes get the not-found card", async ({ page }) => {
  await page.goto("/nope");
  await expect(page.getByRole("heading", { name: "Not here" })).toBeVisible();
});
