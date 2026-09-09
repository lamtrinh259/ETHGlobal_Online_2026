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

test("the nav is a sidebar on a wide screen and a drawer on a narrow one", async ({ page, isMobile }) => {
  await page.goto("/");
  const side = page.locator(".sh-side");
  const burger = page.getByRole("button", { name: "Menu", exact: true });

  if (isMobile) {
    // Closed drawer: off-screen and out of the a11y tree, so its links are not reachable.
    await expect(burger).toBeVisible();
    await expect(side).toHaveAttribute("inert", "");
    await burger.click();
    await expect(side).not.toHaveAttribute("inert", "");
    await expect(page.getByRole("dialog", { name: "Menu" })).toBeVisible();
    await side.getByRole("link", { name: "Verify" }).click();
    await expect(page).toHaveURL(/\/verify$/);
    // A route change closes it again.
    await expect(side).toHaveAttribute("inert", "");
    await burger.click();
    await page.keyboard.press("Escape");
    await expect(side).toHaveAttribute("inert", "");
  } else {
    await expect(burger).toBeHidden();
    await expect(side).not.toHaveAttribute("inert", "");
    await expect(side.getByRole("link", { name: "Verify" })).toBeVisible();
  }
  await noOverflow(page);
});

test("theme toggle persists and stamps <html>", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Light" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("a misconfigured deployment says so before any form", async ({ page }) => {
  await page.route("**/v1/preflight", (route) =>
    route.fulfill({ status: 503, json: { ok: false, warnings: ['domain "google" is not initialised'] } })
  );
  await page.goto("/claim");
  const banner = page.getByTestId("preflight");
  await expect(banner).toContainText("This deployment is not ready");
  await expect(banner).toContainText("google");

  // A healthy deployment shows nothing.
  await page.unroute("**/v1/preflight");
  await page.route("**/v1/preflight", (route) => route.fulfill({ json: { ok: true, warnings: [] } }));
  await page.goto("/claim");
  await expect(page.getByTestId("preflight")).toHaveCount(0);
});

test("health endpoint answers", async ({ request }) => {
  const r = await request.get("/api/health");
  expect(r.ok()).toBeTruthy();
  expect(await r.json()).toMatchObject({ ok: true });
});
