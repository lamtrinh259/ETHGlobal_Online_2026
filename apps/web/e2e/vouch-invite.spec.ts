import { expect, test } from "@playwright/test";

/**
 * Following a candidate's invitation that asks for an account the writer has not attested.
 *
 * "not attested" is a fact; the thing to do about it belongs on the same row. And the way to the
 * profile page carries the invitation back, so the reference written afterwards still counts as one
 * the candidate asked for.
 */
test("an unmet requirement offers the link to attest it, and the way back keeps the invitation", async ({
  page,
}) => {
  const code = "0123456789abcdef0123456789abcd0e";
  await page.goto(`/vouch/alice?invite=${code}`);
  // Before signing in, the page says what was asked and where to go about it — with the way back.
  const preview = page.getByTestId("invite-preview");
  await expect(preview).toContainText("alice asked for a reference from someone who has attested github.com");
  const back = `/me?then=${encodeURIComponent(`/vouch/alice?invite=${code}`)}#link`;
  await expect(preview.getByTestId("link-required-preview")).toHaveAttribute("href", back);
});
