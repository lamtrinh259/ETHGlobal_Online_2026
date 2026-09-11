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
  await page.getByTestId("policy-build").click();
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

/**
 * A verifier pasting an address is asking who holds it.
 *
 * The page led with the shortened address and an ENS technicality about primary names, then a list of
 * names in which the person's own page was a small second link. The answer to the question asked was
 * three reads down the page.
 */
test("a wallet that belongs to somebody says who, first", async ({ page }) => {
  await page.goto("/w/0xEE4811b9462956C9C3535E79c08776D769CA9F3a");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("alice");

  await page.getByTestId("wallet-is").getByRole("link").click();
  await expect(page).toHaveURL(/\/p\/alice$/);
});

/**
 * A verdict is something a reader performs.
 *
 * The page arrived graded against a default nobody chose — a column of ticks saying what the metrics
 * beside it said, under a word passing judgement on a person for a bar they were never told about.
 */
test("a person's page states their records, and grades them only when asked", async ({ page }) => {
  await page.goto("/p/alice");
  await expect(page.getByTestId("checks")).toHaveCount(0);
  await expect(page.getByTestId("completeness")).toHaveCount(0);
  await expect(page.getByTestId("score")).toBeVisible();

  await page.getByTestId("policy-pick").fill("Hiring");
  await page.getByTestId("policy-apply").click();
  await expect(page).toHaveURL(/preset=hiring/);
  await expect(page.getByTestId("checks")).toBeVisible();
  await expect(page.getByTestId("completeness")).toBeVisible();
  await expect(page.getByTestId("policy-line")).toContainText("Checking against");

  await page.getByTestId("policy-clear").click();
  await expect(page).toHaveURL(/\/p\/alice$/);
  await expect(page.getByTestId("checks")).toHaveCount(0);
});

test("a policy nobody has heard of applies nothing", async ({ page }) => {
  await page.goto("/p/alice");
  await page.getByTestId("policy-pick").fill("whatever");
  await expect(page.getByTestId("policy-apply")).toBeDisabled();
});

/**
 * A view code never reaches a server.
 *
 * It is the one-time pad that unmasks an account on chain: permanent, unrevocable, and the whole
 * secret. As `?viewCode=0x…` it was written into this app's access log, the attester's, every proxy
 * between them and the reader's own history — and a secret that never expires cannot be taken back.
 */
test("a view code in the query unmasks nothing; one in the fragment does", async ({ page }) => {
  const code = `0x${"5a".repeat(32)}`;
  const seen: string[] = [];
  page.on("request", (r) => seen.push(r.url()));

  await page.goto(`/p/alice?links=x.com&viewCode=${code}`);
  await expect(page.getByTestId("unmasked")).toHaveCount(0);

  // From here on, nothing that leaves the browser may carry it — the line above put it in a URL on
  // purpose, to show it is ignored.
  seen.length = 0;
  await page.goto(`/p/alice?links=x.com#viewCode=${code}`);
  await expect(page.getByTestId("unmasked")).toBeVisible();
  // Asked for, and not in any URL that left the browser.
  expect(seen.some((u) => u.includes("/v1/verify/"))).toBe(true);
  expect(seen.filter((u) => u.includes(code))).toHaveLength(0);
});

/**
 * A read that failed is not a person with nothing.
 *
 * The page catches a failed read and renders the card anyway, so an attester that is down produced a
 * confident page saying nobody holds this name and nobody has written about it — which is a statement
 * about the world, made from no information, about somebody who may have a dozen references.
 */
test("a candidate whose records could not be read says so, and claims nothing else", async ({ page }) => {
  await page.goto("/p/nobody");
  await expect(page.locator("main [role=alert]")).toBeVisible();
  await expect(page.getByTestId("blank-page")).toHaveCount(0);
  await expect(page.getByTestId("score")).toHaveCount(0);
  await expect(page.getByTestId("checks")).toHaveCount(0);
  // Nor the invitation to write the first reference for somebody who may already have many.
  await expect(page.getByRole("link", { name: "Refer this person" })).toHaveCount(0);
});

test("a wallet whose records could not be read says so, and claims nothing else", async ({ page }) => {
  await page.goto("/w/0x0000000000000000000000000000000000000000");
  await expect(page.locator("main [role=alert]")).toBeVisible();
  // Not "this wallet holds no live name", about a wallet that may hold several.
  await expect(page.getByTestId("wallet-names")).toHaveCount(0);
  await expect(page.getByTestId("wallet-accounts")).toHaveCount(0);
});
