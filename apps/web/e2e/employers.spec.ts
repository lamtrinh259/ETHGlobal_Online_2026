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

  const row = page.getByTestId("standing-alice");
  await expect(row).toBeVisible();
  // The attester answers, so this is a real reading rather than an empty one.
  await expect(row).toContainText("short:");
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
