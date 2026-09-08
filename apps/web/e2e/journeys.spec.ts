import { test, expect } from "@playwright/test";

test("landing offers the three doors and they route", async ({ page }) => {
  await page.goto("/");
  const doors = page.locator(".door");
  await expect(doors).toHaveCount(3);
  await doors.nth(2).click();
  await expect(page).toHaveURL(/\/verify$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Check a candidate");
});

test("verifier form builds a policy URL for the candidate page", async ({ page }) => {
  await page.goto("/verify");
  await page.getByLabel("handle").fill("Alice.ketsuban.eth");
  await page.getByLabel("minimum linked accounts").fill("2");
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page).toHaveURL(/\/p\/alice\?answers=kju-is&minLinks=2&minVouches=3$/);
  // API unreachable in this run: the page still renders the graded card with failing checks + the error.
  await expect(page.getByTestId("completeness")).toHaveText("incomplete");
  await expect(page.getByTestId("checks").locator("li")).toHaveCount(4);
  await expect(page.locator("main [role=alert]").first()).toBeVisible();
});

test("claim and vouch journeys show the stepper and the sign-in gate", async ({ page }) => {
  await page.goto("/claim");
  await expect(page.locator(".stepper li")).toHaveCount(3);
  await expect(page.getByTestId("signin")).toBeVisible({ timeout: 20000 });

  await page.goto("/vouch/alice");
  await expect(page.locator(".stepper li")).toHaveCount(5);
  await expect(page.locator(".stepper li.pending")).toHaveCount(1);
  await expect(page.getByTestId("signin")).toBeVisible({ timeout: 20000 });
});

test("vouch lookup routes to the candidate when the API cannot answer, and blocks unclaimed handles when it can", async ({
  page,
}) => {
  await page.goto("/vouch");
  await page.getByLabel("handle").fill("alice");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/vouch\/alice$/);

  await page.route("**/v1/name/*/nobody", (route) =>
    route.fulfill({ json: { domain: "ketsuban", handle: "nobody", taken: false, wallet: null, live: false } })
  );
  await page.goto("/vouch");
  await page.getByLabel("handle").fill("nobody");
  await expect(page.getByTestId("lookup-status")).toContainText("Nobody has claimed");
  await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
});

test("the dashboard is behind the sign-in gate", async ({ page }) => {
  await page.goto("/me");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your names");
  await expect(page.getByTestId("signin")).toBeVisible({ timeout: 20000 });
});

test("renewal deep link keeps the claim page behind the sign-in gate", async ({ page }) => {
  await page.goto("/claim?renew=ketsuban");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Claim your name");
  await expect(page.locator(".stepper")).toBeVisible();
});
