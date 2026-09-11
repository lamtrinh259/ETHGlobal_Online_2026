import { expect, test } from "@playwright/test";

/**
 * The search box, driven the way somebody drives it.
 *
 * Arrow-then-enter is one gesture: both keys land before React re-renders, and a handler reading
 * state rather than a ref saw no selection and did nothing. `fireEvent` flushes between events, so
 * the unit tests could not have caught it — only a real browser presses keys that fast.
 */
test("arrow down and enter opens a suggestion, pressed as fast as a person presses them", async ({
  page,
}) => {
  await page.goto("/");
  const box = page.getByTestId("name-query");
  await box.fill("alice");
  await expect(page.getByTestId("match-alice")).toBeVisible();

  // No wait between them, which is the whole point.
  await box.press("ArrowDown");
  await box.press("Enter");
  await expect(page).toHaveURL(/\/p\/alice$/);
});

test("the subject is the first row of the ranking, reachable by keyboard", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("matches").locator("li").first()).toContainText("Kim Jong Un");

  const box = page.getByTestId("name-query");
  await box.press("ArrowDown");
  await expect(box).toHaveAttribute("aria-activedescendant", /kju-is/);
});

test("naming a domain keeps the screen, and what was typed in it", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("name-query").fill("bob");
  await page.getByTestId("by-account").fill("x.com");

  await expect(page.getByTestId("searchbar")).toBeVisible();
  await expect(page.getByTestId("name-query")).toHaveValue("bob");
  await expect(page.getByTestId("name-query")).toHaveAttribute("placeholder", "their handle on x.com");
});
