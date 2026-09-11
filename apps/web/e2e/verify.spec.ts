import { test, expect } from "@playwright/test";

// /v/<name> is server-rendered, so the mock attester answers it rather than `page.route`.
test("a person's name lands on their page, and it frames what was read", async ({ page }) => {
  // One page for a person: `/v/<handle>.<root>` is that person, so it goes where they are.
  await page.goto("/v/alice.ketsuban.eth");
  await expect(page).toHaveURL(/\/p\/alice$/);
  await expect(page.getByRole("heading", { name: "alice.ketsuban.eth" })).toBeVisible();
  await expect(page.getByTestId("score")).toBeVisible();

  // What somebody else said about them, and — a tab away — what they said about somebody else.
  await expect(page.getByLabel("references received")).toContainText("Ran the platform team");
  await page.getByTestId("tab-given").click();
  await expect(page.getByTestId("references")).toContainText("a terrible dictator");
  await expect(page.locator(".sh-side")).toBeAttached();

  /*
   * The claim the product rests on: the same name read through the UniversalResolver rather than
   * through this service. It is an appendix behind a disclosure, so a reader only meets it if they go
   * looking — which is the point, and also why nothing noticed it was never rendered here at all.
   */
  const proof = page.getByTestId("ens-proof");
  await expect(proof).toBeVisible();
  await proof.getByText("Read it yourself, through ENS").click();
  await expect(proof).toContainText("0x4A1817d13E9cF196f471725176355C1234b63C70");
});

// A name the attester does not know: the page must say so rather than crash. Not a person's name —
// those are somebody's page now, and an unheld one reads as unclaimed rather than as a failure.
test("a name the attester cannot answer for is an error card, not a crash", async ({ page }) => {
  await page.goto("/v/nobody.x.ketsuban.eth");
  await expect(page.locator("main [role=alert]")).toBeVisible();
  await expect(page.locator(".sh-side")).toBeAttached();
});

test("unknown routes get the not-found card", async ({ page }) => {
  await page.goto("/nope");
  await expect(page.getByRole("heading", { name: "Not here" })).toBeVisible();
});

test("presets fill the policy and encode it into the candidate's URL", async ({ page }) => {
  // The policy is about somebody, so it is asked on their page and folded away until wanted.
  await page.goto("/p/alice");
  await expect(page.getByTestId("presets")).toBeHidden();
  await page.getByTestId("policy-editor").getByText("Your policy").click();
  await page.getByTestId("preset-dao").click();
  await expect(page.getByTestId("policy-summary")).toHaveText(/≥2 live references · humanity attested/);
  await page.getByLabel("minimum live references").fill("5");
  await expect(page.getByTestId("policy-summary")).toHaveText(/≥5 live references/);
  await page.getByRole("button", { name: "Apply to alice" }).click();
  await expect(page).toHaveURL(/\/p\/alice\?answers=kju-is&minLinks=0&minVouches=5&humanity=1$/);
});

test("a wallet address routes to the wallet page, and it reads what the wallet holds", async ({ page }) => {
  await page.goto("/verify");
  // The same field takes an address: it is the other thing a verifier arrives holding.
  await page.getByTestId("name-query").fill("0xEE4811b9462956C9C3535E79c08776D769CA9F3a");
  await page.getByTestId("open-wallet").click();
  await expect(page).toHaveURL(/\/w\/0xEE4811b9462956C9C3535E79c08776D769CA9F3a$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Wallet");

  /*
   * Every list on this page was untested, because nothing answered for a wallet and the page fell to
   * its error card — which was the only thing anybody had ever asserted about it.
   */
  await expect(page.getByTestId("wallet-names")).toContainText("alice.ketsuban.eth");
  // A masked account: held, and not saying which one.
  await expect(page.getByTestId("wallet-accounts")).toContainText("google.com");
  await expect(page.getByTestId("wallet-given")).toContainText("worked with them for years");
});

test("a wallet page says so rather than crashing when it cannot be read", async ({ page }) => {
  await page.goto("/w/not-an-address");
  await expect(page.locator("main [role=alert]")).toHaveText("not a wallet address");
});

/**
 * A person's page is about that person.
 *
 * Below the references sat three cards of machinery: the resolver names, the JSON endpoints, and
 * instructions for aliasing an `.eth` name — the last of which is the subject's own business, shown
 * to every stranger who opened their page, and already a button on the subject's dashboard.
 */
test("the machinery below a person is one appendix, not three cards", async ({ page }) => {
  await page.goto("/p/alice");

  await expect(page.getByText("Bring your own .eth name")).toHaveCount(0);
  // Said once. The editor above is the control; the query string it writes is not a reader's business.
  await expect(page.getByText(/Change it with/)).toHaveCount(0);

  const raw = page.getByTestId("read-it-raw");
  await expect(raw).toBeVisible();
  // Folded away: a reader deciding about a person meets it only if they go looking.
  await expect(raw.locator("code").first()).toBeHidden();
  await raw.getByText("Read it without this app").click();
  await expect(raw).toContainText("/v1/verify/alice.ketsuban.eth");
  await expect(raw).toContainText("/v1/vouches/alice");
});

test("the one thing to do with a person read about is offered once", async ({ page }) => {
  await page.goto("/p/alice");
  // It was a primary button in the references tab and a text link in the share card below it.
  await expect(page.getByRole("link", { name: /vouch|Refer this person/i })).toHaveCount(1);
});
