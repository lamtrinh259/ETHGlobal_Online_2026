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
  await page.getByTestId("name-query").fill("alice");
  await page.getByTestId("pick-alice").click();
  await page.getByLabel("minimum linked accounts").fill("2");
  await page.getByRole("button", { name: "Check alice" }).click();
  await expect(page).toHaveURL(/\/p\/alice\?answers=kju-is&minLinks=2&minVouches=3$/);
  // The attester answers, so the card is graded against a real read rather than against nothing.
  await expect(page.getByTestId("checks").locator("li")).toHaveCount(4);
  await expect(page.getByTestId("policy-line")).toContainText("3");
  // One live reference against a policy asking for three: the page says so rather than passing it.
  await expect(page.getByTestId("completeness")).toHaveText("incomplete");
});

test("the vouch page explains every step in the voucher's own words", async ({ page }) => {
  await page.goto("/vouch/alice");
  const steps = page.locator(".journey li");
  await expect(steps).toHaveCount(3);
  await expect(steps.nth(0)).toContainText("no seed phrase");
  // This deployment can ask for a proof of humanity, so the step offers it. It read "coming soon"
  // while the mock's `/v1/instances` did not parse and `humanity` never reached the page.
  await expect(steps.nth(1)).toContainText("Prove you are one real person");
  await expect(steps.nth(2)).toContainText("Write and sign the reference for alice");
});

test("the profile and the vouch journey show their steps and the sign-in gate", async ({ page }) => {
  // Claiming lives on the profile now; the old link still gets there.
  await page.goto("/claim");
  await expect(page).toHaveURL(/\/me$/);
  await expect(page.getByTestId("signin")).toBeVisible({ timeout: 20000 });

  await page.goto("/vouch/alice");
  await expect(page.locator(".journey li")).toHaveCount(3);
  // Nothing is pending: a step is only pending where the deployment cannot offer it, and this one
  // can. The count was 1 because the humanity step could not be offered from a fixture that failed
  // to parse, which is the same failure the page is built to survive and therefore not to announce.
  await expect(page.locator(".journey li.pending")).toHaveCount(0);
  await expect(page.getByTestId("signin")).toBeVisible({ timeout: 20000 });
});

test("vouch lookup finds the candidate, and their page says whether a reference can hang on it", async ({
  page,
}) => {
  // One field, the same one a verifier uses. What state the name is in is said on the candidate's own
  // page, which is the screen where the reference actually gets written.
  await page.goto("/vouch");
  await page.getByTestId("name-query").fill("alice");
  await page.getByTestId("pick-alice").click();
  await expect(page).toHaveURL(/\/vouch\/alice$/);

  /*
   * An expired name is a dead end: a reference needs something live to hang on. The fixture is the
   * mock's, not a route interception — this page renders on the server, where nothing in the browser
   * can answer for it.
   */
  await page.goto("/vouch/lapsed");
  await expect(page.getByTestId("candidate-status")).toContainText("expired");
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
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Refer");
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

test("a reference link carrying a popular ask renders, rather than failing on the server", async ({
  page,
}) => {
  // This is the shape that broke: the page is a server component and reads the ask from the URL, so
  // a helper living in a "use client" module made the whole route fail to render. Unit tests cannot
  // see that boundary; only a real build can.
  const errors: string[] = [];
  page.on("response", (r) => {
    if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`);
  });

  await page.goto("/vouch/alice?ask=kju-is");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Refer");
  // An ask nobody offers is not an error either: the writer gets the plain form.
  await page.goto("/vouch/alice?ask=not-an-ask");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Refer");
  expect(errors).toEqual([]);
});

// A journey for the multi-account reveal would need a live API: `/v/<name>` fetches on the server, so
// Playwright's route interception never sees it, and without a card the panels are not reached at all.
// That path is covered by the unit tests for the page and by the docker e2e for the endpoints.
