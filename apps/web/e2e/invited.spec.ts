import { expect, test } from "@playwright/test";

/**
 * Where an employer's invitation lands: the person's own page, carrying the code.
 *
 * The link is `/me?invite=<code>`, the same shape a vouch link has. The page says who is asking, what
 * they require and which account to begin with — from the record the attester holds, not from
 * anything in the link.
 */
test("an invitation says who is asking, the bar, and which account to begin with", async ({ page }) => {
  await page.goto("/me?invite=0123456789abcdef0123456789abcdef");
  const invited = page.getByTestId("invited");
  await expect(invited).toContainText("peersky.ketsuban.eth is inviting you");
  await expect(invited.getByTestId("invited-bar")).toContainText("≥2 live references");
  const begin = invited.getByTestId("invited-begin");
  await expect(begin).toContainText("github.com");
  await expect(begin).toContainText("@lamtrinh259");
  // And the page itself is right below: signing in and linking happens here, not on a detour.
  await expect(page.getByTestId("signin")).toBeVisible();
});

test("once the person has a page, the invitation reads it against the bar instead", async ({ page }) => {
  await page.goto("/me?invite=0123456789abcdef0123456789abcdec");
  const claimed = page.getByTestId("invited-claimed");
  await expect(claimed).toContainText("@lamtrinh259");
  await expect(claimed.getByRole("link")).toHaveAttribute(
    "href",
    "/p/alice?answers=kju-is&minLinks=1&minVouches=2"
  );
  await expect(page.getByTestId("invited-begin")).toHaveCount(0);
});

test("a code nobody kept is said to be one, not an empty invitation", async ({ page }) => {
  await page.goto("/me?invite=ffffffffffffffffffffffffffffffff");
  await expect(page.getByTestId("invited-unknown")).toContainText("No invitation with that code");
  await page.goto("/me?invite=not-a-code");
  await expect(page.getByTestId("invited-unknown")).toBeVisible();
  // Without a code the page is simply the page.
  await page.goto("/me");
  await expect(page.getByTestId("invited-unknown")).toHaveCount(0);
});
