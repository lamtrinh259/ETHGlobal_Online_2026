import { expect, test } from "@playwright/test";

/**
 * What a reader without JavaScript gets.
 *
 * A crawler, a link unfurler, an agent following a name: none of them run scripts. The product's claim
 * is that a name can be read without its app, and these pages are Server Components written for
 * exactly that. They were shipping a title and an empty document, because the providers withheld every
 * child until React mounted in a browser — so the one reader the server rendering was for never saw
 * any of it.
 */
test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("a candidate page carries its own content", async ({ page }) => {
    await page.goto("/p/alice");
    await expect(page.getByTestId("profile-head")).toContainText("alice.ketsuban.eth");
    // The references are what a verifier came for, and they are in the document.
    await expect(page.getByLabel("references received")).toContainText("Ran the platform team");
  });

  test("a name that is not a person still explains itself", async ({ page }) => {
    await page.goto("/v/bob.alice.ketsuban.eth");
    await expect(page.locator("main")).not.toBeEmpty();
  });

  test("the front page says what this is", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("cannot be");
  });
});
