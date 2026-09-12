import { describe, expect, it } from "vitest";
import { describeRequirement, missingRequirements, whyUnsatisfiable, wrongAccount } from "@/lib/invite";

const parents = ["ketsuban.eth", "kju-is.ketsuban.eth"];

describe("an invitation somebody could actually satisfy", () => {
  it("takes a mail host, which is what the field is for", () => {
    expect(whyUnsatisfiable("mit.edu", parents)).toBeNull();
    expect(whyUnsatisfiable("peeramid.xyz", parents)).toBeNull();
  });

  it("takes one person on a platform, and knows when the writer is somebody else", () => {
    expect(whyUnsatisfiable("github.com/lam", parents)).toBeNull();
    expect(whyUnsatisfiable("github.com/not a handle", parents)).toMatch(/not a handle/);
    expect(describeRequirement("github.com/Lam")).toBe("github.com as @lam");
    // The domain is what has to be attested; the handle is checked against the sign-in.
    expect(missingRequirements(["github.com/lam"], ["github.com"], parents)).toEqual([]);
    expect(missingRequirements(["github.com/lam"], [], parents)).toEqual(["github.com/lam"]);
    expect(wrongAccount("github.com/lam", [{ domain: "github", label: "lam" }])).toBeNull();
    expect(wrongAccount("github.com/lam", [{ domain: "github", label: "bob" }])).toMatch(
      /for @lam on github.com; the account linked here is @bob/
    );
    expect(wrongAccount("github.com/lam", [])).toMatch(/no account there is linked here/);
    expect(wrongAccount("mit.edu/tim", [{ domain: "google", label: "tim@mit.edu" }])).toBeNull();
    expect(wrongAccount("mit.edu", [])).toBeNull();
  });

  it("refuses Telegram, which this deployment cannot link", () => {
    expect(whyUnsatisfiable("t.me", parents)).toMatch(/Telegram is not enabled/);
    expect(whyUnsatisfiable("github.com", parents)).toBeNull();
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
