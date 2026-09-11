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
  await expect(page.getByTestId("name-query")).toHaveAttribute("placeholder", "their handle");
});

/**
 * Enter, with nothing arrowed to.
 *
 * A search box people type a name into is a box they press enter on — that is what enter is for
 * everywhere else they have typed a name. Here it required arrowing down first, so typing the name
 * of somebody who was right there on screen and pressing enter did nothing at all.
 */
test("typing a name and pressing enter opens the best match", async ({ page }) => {
  await page.goto("/");
  const box = page.getByTestId("name-query");
  await box.fill("alice");
  await expect(page.getByTestId("match-alice")).toBeVisible();

  await box.press("Enter");
  await expect(page).toHaveURL(/\/p\/alice$/);
});

test("enter on a name nobody holds opens the page it would make", async ({ page }) => {
  await page.goto("/");
  const box = page.getByTestId("name-query");
  await box.fill("nobody-holds-this");
  await expect(page.getByTestId("no-match")).toBeVisible();

  await box.press("Enter");
  await expect(page).toHaveURL(/\/p\/nobody-holds-this$/);
});

test("enter with a domain named opens the account it resolves to, not a hidden name match", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("by-account").fill("x.com");
  await page.getByTestId("name-query").fill("alice");
  await expect(page.getByTestId("who-result")).toContainText("That is");

  await page.getByTestId("name-query").press("Enter");
  await expect(page).toHaveURL(/\/p\/alice$/);
});

/**
 * Where "nobody holds that name" actually leads.
 *
 * The page it makes was graded like a candidate: a column of crosses and a score of nothing, which is
 * a verdict on somebody who has never been here.
 */
test("a name nobody holds opens a page that says so, rather than failing them", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("name-query").fill("unheld");
  await page.getByTestId("use-anyway").click();

  await expect(page).toHaveURL(/\/p\/unheld$/);
  await expect(page.getByTestId("blank-page")).toContainText("Nobody holds this name");
  await expect(page.getByTestId("checks")).toHaveCount(0);
  await expect(page.getByTestId("score")).toHaveCount(0);
  // Both of the things there are to do with it.
  await expect(page.getByRole("link", { name: "Refer this person" })).toBeVisible();
  await expect(page.getByTestId("blank-page").getByRole("link", { name: "claims the name" })).toBeVisible();
});

/**
 * The scope is not the search, and has to look like it.
 *
 * Two text inputs shared the bar with two grey placeholders of the same weight, and the rule meant to
 * divide them never applied: `.searchbar-row > input { border: 0 }` outweighs a bare class, so the
 * chip and the query sat flush against each other on every screen since the bar was built.
 */
test("the scope reads as a scope, set off from the field it qualifies", async ({ page }) => {
  await page.goto("/");
  const bg = (id: string) => page.getByTestId(id).evaluate((el) => getComputedStyle(el).backgroundColor);

  expect(await bg("by-account")).not.toBe(await bg("name-query"));
  const border = await page.getByTestId("by-account").evaluate((el) => getComputedStyle(el).borderLeftWidth);
  expect(border).not.toBe("0px");
});
