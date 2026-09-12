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
  // Deleting a record is a transaction, and every transaction here ends in the same confirmation.
  await expect(page.getByTestId("tx-done")).toBeVisible();
  await expect(page.getByTestId("tx-done-link")).toHaveAttribute(
    "href",
    /^https:\/\/sepolia\.etherscan\.io\/tx\/0x/
  );
  // Escape rather than the close button: under mobile emulation the layout viewport is taller than the
  // visual one, and a click into a fixed overlay lands on the backdrop. The button is covered in
  // test/TxDone.test.tsx; what matters here is that closing it gives the page back.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("tx-done")).toBeHidden();
  await expect(page.getByTestId("admin-result")).toContainText("Deleted the record on chain");
});
