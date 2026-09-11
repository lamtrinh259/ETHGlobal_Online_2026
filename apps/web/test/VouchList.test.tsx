import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { VouchList } from "@/app/VouchList";

/**
 * What a reader is told about how a reference arrived.
 *
 * `unsolicited` is the one word on this page a verifier can misread as a verdict, and the explanation
 * used to live in a `title` attribute, which a phone has no way to show at all.
 */
const base = {
  voucher: "bob",
  voucherName: "bob.ketsuban.eth",
  statement: "worked together",
  nonce: "1",
  live: true,
  validUntil: "2027-01-01T00:00:00.000Z",
  solicited: true,
  letter: null,
  letterHash: null,
  standing: { claimed: true, given: 1, received: 0 },
} as never;

afterEach(cleanup);

describe("how a reference arrived", () => {
  it("explains the badge in the page, where a phone can read it", () => {
    render(<VouchList vouches={[{ ...(base as object), solicited: false } as never]} handle="alice" />);
    const said = screen.getByTestId("unsolicited-note").textContent ?? "";
    expect(said).toMatch(/no invitation from alice came with that reference/);
    // The badge is about the invitation. A candidate whose link was unsatisfiable gets references
    // marked this way too, so the page must not say they never asked.
    expect(said).toMatch(/not proof that alice never asked/);
  });

  it("says nothing about it when every reference was asked for", () => {
    render(<VouchList vouches={[base]} handle="alice" />);
    expect(screen.queryByTestId("unsolicited-note")).toBeNull();
  });
});
