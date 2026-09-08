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

test("verify form presets fill the policy and encode it into the reference page URL", async ({ page }) => {
  await page.goto("/verify");
  await page.getByLabel("handle").fill("Alice.ketsuban.eth");
  await page.getByTestId("preset-dao").click();
  await expect(page.getByTestId("policy-summary")).toHaveText(/≥2 live references · humanity attested/);
  await page.getByLabel("minimum live references").fill("5");
  await expect(page.getByTestId("policy-summary")).toHaveText(/≥5 live references/);
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page).toHaveURL(/\/p\/alice\?answers=kju-is&minLinks=0&minVouches=5&humanity=1$/);
});
