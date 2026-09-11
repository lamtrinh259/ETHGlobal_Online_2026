import { describe, expect, it } from "vitest";
import { humanityError } from "@/lib/humanity";

/**
 * The widget answers with a machine code. `credential_unavailable` is what somebody sees when the
 * credential this deployment asked for was never enabled for the app — a configuration problem they
 * cannot fix, and the page used to print the code at them as though they had done something wrong.
 */
describe("what an IDKit error means to the person who hit it", () => {
  it("blames the preview, not the person, when Selfie Check is not switched on", () => {
    const said = humanityError("credential_unavailable", "selfie");
    expect(said).toContain("in preview");
    expect(said).toContain("Nothing is wrong on your side");
  });

  it("says what is actually missing when the Orb-backed credential was asked for", () => {
    expect(humanityError("credential_unavailable", "proof_of_human")).toContain("Orb");
  });

  it("says nothing was written when somebody simply cancelled", () => {
    expect(humanityError("user_rejected", "selfie")).toContain("Nothing was written");
  });

  /*
   * Every code World can answer with, and what each one has to become.
   *
   * The grouping is the point: a person who cancelled, a person whose app is too old, and a
   * deployment whose registration is wrong are three different situations, and the widget reports all
   * of them as an identifier with underscores in it. Each was met while integrating Selfie Check —
   * `docs/selfie-check-feedback.md` says what they cost — and each is somebody stuck on a page.
   */
  const codes: [string, RegExp][] = [
    ["feature_unavailable", /preview/],
    ["world_id_3_not_available", /too old/],
    ["world_id_4_not_available", /too old/],
    ["max_verifications_reached", /as many times as the action allows/],
    ["nullifier_replayed", /already been spent/],
    ["verification_rejected", /could not verify/],
    ["unknown_rp", /does not recognise this app/],
    ["inactive_rp", /does not recognise this app/],
    ["invalid_rp_signature", /took too long/],
    ["rp_signature_expired", /took too long/],
    ["timestamp_too_old", /took too long/],
    ["connection_failed", /Check your connection/],
  ];

  it.each(codes)("turns %s into something a person can act on", (code, says) => {
    expect(humanityError(code, "selfie")).toMatch(says);
  });

  it("never shows a machine code to somebody it has a sentence for", () => {
    // The failure this module exists to prevent: an identifier printed at a person as though it were
    // an explanation. Underscores are how one is recognised, since no sentence here contains any.
    for (const [code] of codes) {
      for (const credential of ["selfie", "proof_of_human"] as const) {
        const said = humanityError(code, credential);
        expect(said, code).not.toBe(code);
        expect(said, code).not.toMatch(/_/);
        expect(said.endsWith("."), `${code} does not read as a sentence`).toBe(true);
      }
    }
  });

  it("passes an unrecognised code through rather than dressing it up", () => {
    // A code that means something new is still legible; a made-up sentence would not be.
    expect(humanityError("some_new_code", "selfie")).toBe("some_new_code");
  });
});
