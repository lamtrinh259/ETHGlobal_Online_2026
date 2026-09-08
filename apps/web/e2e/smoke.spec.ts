import { test, expect, type Page } from "@playwright/test";

const j = (b: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(b) });

const verification = {
  name: "alice.ketsuban.eth",
  instance: { domain: "ketsuban", parentName: "ketsuban.eth" },
  status: "active",
  wallet: "0xEE4811b9462956C9C3535E79c08776D769CA9F3a",
  answer: "terrible dictator",
  expiresAt: "2026-10-08T09:14:22.000Z",
  humanity: null,
  links: [{ domain: "x", optedIn: true, commitment: "0x01" }],
  evidence: ["wallet_binding", "x_account_control"],
  decision: "additional_context_available",
  warning: "This is not identity, employment, safety, malware, nationality, or affiliation verification.",
};

async function noOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

test("landing renders the shell and the three doors without horizontal overflow", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("cannot be");
  await expect(page.locator(".door")).toHaveCount(3);
  await noOverflow(page);
  await page.goto("/claim");
  await expect(page.getByTestId("signin")).toBeVisible({ timeout: 20000 });
  await noOverflow(page);
});

test("theme toggle persists and stamps <html>", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Light" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("health endpoint answers", async ({ request }) => {
  const r = await request.get("/api/health");
  expect(r.ok()).toBeTruthy();
  expect(await r.json()).toMatchObject({ ok: true });
});
