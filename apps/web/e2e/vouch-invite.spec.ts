import { expect, test } from "@playwright/test";

/**
 * Following a candidate's invitation that asks for an account the writer has not attested.
 *
 * "not attested" is a fact; the thing to do about it belongs on the same row. And the way to the
 * profile page carries the invitation back, so the reference written afterwards still counts as one
 * the candidate asked for.
 */
test("an unmet requirement is said before signing in, and attested on the page itself afterwards", async ({
  page,
}) => {
  const code = "0123456789abcdef0123456789abcd0e";
  await page.goto(`/vouch/alice?invite=${code}`);
  // Before signing in, the page says what was asked, in the writer's own box.
  const preview = page.getByTestId("invite-preview");
  await expect(preview).toContainText("alice asks for");
  await expect(preview).toContainText("github.com");
  // Nothing sends the writer away to a profile page: the account is linked and attested right here.
  await expect(preview.locator("a[href^='/me']")).toHaveCount(0);
});
