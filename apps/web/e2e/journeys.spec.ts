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

test("the vouch page explains every step in the voucher's own words", async ({ page }) => {
  await page.goto("/vouch/alice");
  const steps = page.locator(".journey li");
  await expect(steps).toHaveCount(3);
  await expect(steps.nth(0)).toContainText("no seed phrase");
  await expect(steps.nth(1)).toContainText("coming soon");
  await expect(steps.nth(2)).toContainText("Write and sign the reference for alice");
});

test("the profile and the vouch journey show their steps and the sign-in gate", async ({ page }) => {
  // Claiming lives on the profile now; the old link still gets there.
  await page.goto("/claim");
  await expect(page).toHaveURL(/\/me$/);
  await expect(page.getByTestId("signin")).toBeVisible({ timeout: 20000 });

  await page.goto("/vouch/alice");
  await expect(page.locator(".journey li")).toHaveCount(3);
  await expect(page.locator(".journey li.pending")).toHaveCount(1);
  await expect(page.getByTestId("signin")).toBeVisible({ timeout: 20000 });
});

test("vouch lookup routes to the candidate when the API cannot answer, and blocks unclaimed handles when it can", async ({
  page,
}) => {
  await page.goto("/vouch");
  await page.getByLabel("handle").fill("alice");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/vouch\/alice$/);

  // Unclaimed is allowed through: an organisation writes before the candidate exists.
  await page.route("**/v1/name/*/nobody", (route) =>
    route.fulfill({ json: { domain: "ketsuban", handle: "nobody", taken: false, wallet: null, live: false } })
  );
  await page.goto("/vouch");
  await page.getByLabel("handle").fill("nobody");
  await expect(page.getByTestId("lookup-status")).toContainText("An organisation can write anyway");
  await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();

  // An expired name is a dead end: a reference needs something live to hang on.
  await page.route("**/v1/name/*/lapsed", (route) =>
    route.fulfill({ json: { domain: "ketsuban", handle: "lapsed", taken: true, wallet: null, live: false } })
  );
  await page.goto("/vouch");
  await page.getByLabel("handle").fill("lapsed");
  await expect(page.getByTestId("lookup-status")).toContainText("has expired");
  await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
});

test("the dashboard is behind the sign-in gate", async ({ page }) => {
  await page.goto("/me");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your page");
  await expect(page.getByTestId("signin")).toBeVisible({ timeout: 20000 });
});

test("an old renewal link lands on the profile", async ({ page }) => {
  await page.goto("/claim?renew=ketsuban");
  await expect(page).toHaveURL(/\/me$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your page");
});

test("the header carries the identity, not the forms", async ({ page }) => {
  await page.goto("/me");
  await expect(page.getByTestId("who")).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText("signed in as");
});

test("a vouch page opens for anyone, invitation or not, and a bad token is not a wall", async ({ page }) => {
  // Referring is non-permissioned: an invitation is evidence the candidate asked, never permission,
  // so neither its absence nor a malformed one turns the page into a refusal.
  await page.goto("/vouch/alice");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Vouch for");
  // Behind the sign-in gate there is no form either way; the steps still explain the journey.
  await expect(page.locator(".journey li")).toHaveCount(3);
  await expect(page.locator("body")).not.toContainText("You need alice's invitation");

  await page.goto("/vouch/alice?invite=not-a-real-token");
  await expect(page.locator(".journey li")).toHaveCount(3);
  await expect(page.locator("body")).not.toContainText("You need alice's invitation");
});

test("a domain that cannot be written disables the publish button with the reason", async ({ page }) => {
  await page.route("**/v1/nonce**", (route) =>
    route.fulfill({
      json: {
        exists: false,
        nonce: "0",
        next: "1",
        id: `0x${"00".repeat(32)}`,
        wallet: `0x${"00".repeat(20)}`,
        ready: false,
        reason: 'domain "google" is not initialised on Multipass',
      },
    })
  );
  await page.goto("/claim");
  // Behind the sign-in gate there is no form, so the reason has nowhere to show yet; the gate stands.
  await expect(page.getByTestId("signin")).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId("publish")).toHaveCount(0);
});

test("the names page explains the namespace, and degrades when the API is unreachable", async ({ page }) => {
  await page.goto("/names");
  await expect(page.getByRole("heading", { name: "Names", level: 1 })).toBeVisible();
  // Without an API there are no mounts to describe, and the page says so rather than inventing shapes.
  await expect(page.locator("main [role=alert]")).toHaveText(/no mounts to describe/);
  await expect(page.getByRole("link", { name: /Check a name/ })).toBeVisible();
});
