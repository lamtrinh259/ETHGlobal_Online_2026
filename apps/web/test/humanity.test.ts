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

  it("passes an unrecognised code through rather than dressing it up", () => {
    // A code that means something new is still legible; a made-up sentence would not be.
    expect(humanityError("some_new_code", "selfie")).toBe("some_new_code");
  });
});
