import { test, expect } from "@playwright/test";

// /v/<name> is server-rendered, so the mock attester answers it rather than `page.route`.
test("verify page reads a name through the resolver and frames it", async ({ page }) => {
  await page.goto("/v/alice.ketsuban.eth");
  await expect(page.getByRole("heading", { name: "alice.ketsuban.eth" })).toBeVisible();
  await expect(page.getByTestId("status")).toHaveText("active");
  // What the person said about somebody else, and what somebody else said about them.
  await expect(page.getByTestId("references")).toContainText("a terrible dictator");
  await expect(page.getByLabel("references received")).toContainText("Ran the platform team");
  await expect(page.locator(".sh-side")).toBeAttached();

  /*
   * The claim the product rests on: the same name read through the UniversalResolver rather than
   * through this service. It is an appendix behind a disclosure, so a reader only meets it if they go
   * looking — which is the point, and also why nothing noticed it was never rendered here at all.
   */
  const proof = page.getByTestId("ens-proof");
  await expect(proof).toBeVisible();
  await proof.getByText("Read it yourself, through ENS").click();
  await expect(proof).toContainText("0x4A1817d13E9cF196f471725176355C1234b63C70");
});

// A name the attester does not know: the page must say so rather than crash.
test("a name the attester cannot answer for is an error card, not a crash", async ({ page }) => {
  await page.goto("/v/nobody.ketsuban.eth");
  await expect(page.locator("main [role=alert]")).toBeVisible();
  await expect(page.locator(".sh-side")).toBeAttached();
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

test("a wallet address routes to the wallet page, which degrades when it cannot be read", async ({
  page,
}) => {
  await page.goto("/verify");
  await page.getByLabel("handle").fill("0xEE4811b9462956C9C3535E79c08776D769CA9F3a");
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page).toHaveURL(/\/w\/0xEE4811b9462956C9C3535E79c08776D769CA9F3a$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Wallet");
  // The mock answers 404 for a wallet, which is the same shape as an attester that cannot read one.
  await expect(page.locator("main [role=alert]")).toBeVisible();

  await page.goto("/w/not-an-address");
  await expect(page.locator("main [role=alert]")).toHaveText("not a wallet address");
});
