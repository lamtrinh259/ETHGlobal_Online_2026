import { expect, test } from "@playwright/test";

/**
 * What a page owes a reader who is not looking at it.
 *
 * None of this is a full audit — contrast and focus order are not here — but every one of these is a
 * control that a screen reader announces as nothing at all: a field with no label, a button whose only
 * content is an icon, an image with no alt. They are also the ones that arrive by accident, one new
 * control at a time, and no page-level test notices because the page still looks right.
 */
const PAGES = [
  "/",
  "/p/alice",
  "/v/kju-is.ketsuban.eth",
  "/employers",
  "/vouch/alice",
  "/trust",
  "/w/0xEE4811b9462956C9C3535E79c08776D769CA9F3a",
];

for (const path of PAGES) {
  test(`${path} names everything it asks a reader to use`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator("main")).toBeVisible();

    const faults = await page.evaluate(() => {
      const out: string[] = [];
      const named = (el: Element) =>
        (el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent || "").trim();

      for (const el of document.querySelectorAll("main img"))
        if (!el.hasAttribute("alt")) out.push(`img with no alt: ${el.getAttribute("src")?.slice(0, 60)}`);

      for (const el of document.querySelectorAll("main button, main a"))
        if (!named(el))
          out.push(`${el.tagName.toLowerCase()} with no accessible name: ${el.outerHTML.slice(0, 90)}`);

      for (const el of document.querySelectorAll("main input, main select, main textarea")) {
        const id = el.getAttribute("id");
        const labelled =
          el.getAttribute("aria-label") ||
          el.getAttribute("aria-labelledby") ||
          el.closest("label") ||
          (id && document.querySelector(`label[for="${CSS.escape(id)}"]`));
        if (!labelled) out.push(`field with no label: ${el.outerHTML.slice(0, 90)}`);
      }

      // A reader moving by headings should not fall through a level that was never written.
      const levels = [...document.querySelectorAll("main h1,main h2,main h3,main h4")].map((h) =>
        Number(h.tagName[1])
      );
      for (let i = 1; i < levels.length; i++)
        if (levels[i] - levels[i - 1] > 1) out.push(`heading jumps h${levels[i - 1]} to h${levels[i]}`);
      if (levels.length === 0) out.push("no heading at all");

      return out;
    });

    expect(faults, `on ${path}`).toEqual([]);
  });
}
