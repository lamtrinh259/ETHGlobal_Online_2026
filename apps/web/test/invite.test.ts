import { describe, expect, it } from "vitest";
import { missingRequirements, whyUnsatisfiable } from "@/lib/invite";

const parents = ["ketsuban.eth", "kju-is.ketsuban.eth"];

describe("an invitation somebody could actually satisfy", () => {
  it("takes a mail host, which is what the field is for", () => {
    expect(whyUnsatisfiable("mit.edu", parents)).toBeNull();
    expect(whyUnsatisfiable("peeramid.xyz", parents)).toBeNull();
  });

  it("refuses a username, which has no record of its own to find", () => {
    // The one that cost a real invitation: asking for `lamtrinh259` alongside `github.com` made the
    // whole invitation impossible, and the writer was told only that their reference was unsolicited.
    const said = whyUnsatisfiable("lamtrinh259", parents);
    expect(said).toMatch(/username, not a domain/);
  });

  it("refuses a name in this deployment, which is not somewhere a writer attests", () => {
    expect(whyUnsatisfiable("lam.ketsuban.eth", parents)).toMatch(/name in this deployment/);
    expect(whyUnsatisfiable("ketsuban.eth", parents)).toMatch(/name in this deployment/);
  });

  it("says nothing about an empty field, which asks for nothing", () => {
    expect(whyUnsatisfiable("   ", parents)).toBeNull();
  });
});

describe("what the writer still has to link", () => {
  it("names what was asked for and is not attested", () => {
    expect(missingRequirements(["github.com", "x.com"], ["x.com"], parents)).toEqual(["github.com"]);
  });

  it("counts a masked account, which is how this is answered without naming the account", () => {
    // `attested` is every live record's domain, masked or not: holding one is the whole question.
    expect(missingRequirements(["github.com"], ["github.com"], parents)).toEqual([]);
  });

  it("never sends a writer after something nobody could hold", () => {
    // Blocking on `lamtrinh259` would be a wall with nothing behind it.
    expect(missingRequirements(["github.com", "lamtrinh259"], ["github.com"], parents)).toEqual([]);
  });

  it("asks nothing of a writer the invitation asked nothing of", () => {
    expect(missingRequirements([], [], parents)).toEqual([]);
  });
});
