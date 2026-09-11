import { describe, expect, it } from "vitest";
import { whyUnsatisfiable } from "@/lib/invite";

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
