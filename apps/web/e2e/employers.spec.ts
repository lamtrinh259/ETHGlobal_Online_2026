import { expect, test } from "@playwright/test";

/**
 * The side that hires checks a list, not a person.
 *
 * Everything it needs existed one candidate at a time: a bar, a link carrying it, and a reading of
 * somebody against it. What was missing is the list — the same question asked of everybody under
 * consideration, answered side by side rather than one page at a time.
 */
test("a bar, a list, and where each of them stands", async ({ page }) => {
  await page.goto("/employers");

  await page.getByTestId("employer-preset-dao").click();
  await expect(page.getByTestId("employer-bar")).toContainText("humanity attested");

  await page.getByTestId("employer-note").fill("Backend engineer, Q4");
  await page.getByTestId("name-query").fill("alice");
  await page.getByTestId("pick-alice").click();

  // The row that was picked says so, since the list itself is further down the page.
  await expect(page.getByTestId("pick-alice")).toContainText("on the list");
  await expect(page.getByTestId("pick-alice")).toBeDisabled();
  const row = page.getByTestId("standing-alice");
  await expect(row).toBeVisible();
  // The attester answers, so this is a real reading rather than an empty one.
  await expect(row).toContainText("short:");
  // And the shape behind the count, since a shortlist is where people are compared.
  await expect(row.getByTestId("shape-alice")).toContainText("1 of 2 referrers know each other");
  await expect(row.getByTestId("shape-alice")).toContainText("proved human");
  // And how her references read, in the row, where people are compared.
  await expect(row.getByTestId("read-alice")).toContainText("1 of 2 read as supportive · 1 critical");
  // Reading them opens their page carrying the same bar, so the row and the page cannot disagree.
  await row.getByRole("link", { name: "Read" }).click();
  await expect(page).toHaveURL(/\/p\/alice\?.*preset=dao/);
});

test("the list survives a reload, because it is the reader's own", async ({ page }) => {
  await page.goto("/employers");
  await page.getByTestId("name-query").fill("alice");
  await page.getByTestId("pick-alice").click();
  await expect(page.getByTestId("standing-alice")).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("standing-alice")).toBeVisible();

  await page.getByRole("button", { name: "remove alice" }).click();
  await expect(page.getByTestId("standing-alice")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("standing-alice")).toHaveCount(0);
});

/**
 * Somebody with no page yet.
 *
 * An employer knows a person by an account, and nobody holds a name for it. The answer is not a dead
 * end but an invitation: signed by the employer, kept by the attester under a code, and listed on
 * the employer's own page as a pending check until the person comes. Signing needs a wallet, which
 * the browser test has none of, so what is asserted is the offer and the gate in front of it.
 */
test("an account nobody holds a name for is offered an invitation to pass the bar", async ({ page }) => {
  await page.goto("/employers");
  await page.getByTestId("by-account").fill("x.com");
  await page.getByTestId("name-query").fill("nobodyhere");
  await expect(page.getByTestId("invite-to-policy-button")).toBeVisible();
  // The plain ask is not offered here: an employer has a bar to name.
  await expect(page.getByTestId("invite-to-claim")).toHaveCount(0);
  await expect(page.getByTestId("invite-signin")).toContainText("sign in with a name you hold");
});

/**
 * Somebody already on the list is invited the same way: signed by the employer, worded for the
 * person, a code the attester keeps. The plain "ask" that carried the bar in prose is gone.
 */
test("a candidate on the list is invited to pass the bar, not sent a paragraph", async ({ page }) => {
  await page.goto("/employers");
  await page.getByTestId("name-query").fill("alice");
  await page.getByTestId("pick-alice").click();
  const row = page.getByTestId("standing-alice");
  await expect(row.getByTestId("invite-alice")).toBeVisible();
  await expect(row.getByRole("button", { name: "Copy the ask" })).toHaveCount(0);
});

test("a policy is found by typing its name", async ({ page }) => {
  await page.goto("/employers");
  await page.getByTestId("employer-policy-pick").fill("landlord");
  await page.getByTestId("employer-policy-apply").click();
  await expect(page.getByTestId("employer-preset-landlord")).toHaveClass(/primary/);
});
