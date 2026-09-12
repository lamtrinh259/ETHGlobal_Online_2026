import { expect, test } from "@playwright/test";

/**
 * Demo only: the page that runs the Selfie Check again on the same person. Not linked from anywhere;
 * it asks for the token, reads the account, and says what the reset did.
 */
test("the admin page reads an account and resets its Selfie Check", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.getByTestId("admin")).toContainText("Demo only");
  await page.getByTestId("admin-token").fill("admin-token-0123456789abcdef");
  await page.getByTestId("admin-who").fill("alice");
  await page.getByTestId("admin-look").click();
  await expect(page.getByTestId("admin-onchain")).toContainText("yes, nonce 1");
  page.once("dialog", (d) => void d.accept());
  await page.getByTestId("admin-reset").click();
  await expect(page.getByTestId("admin-result")).toContainText("Forgot 1 nullifier");
  await expect(page.getByTestId("admin-result")).toContainText("Deleted the record on chain");
});
