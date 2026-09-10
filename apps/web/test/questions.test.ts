import { describe, expect, it } from "vitest";
import { questionFor, questionTitle } from "@/lib/questions";

describe("the question a subject instance asks", () => {
  it("is the question, not the domain it lives in", () => {
    // `kju-is` means nothing to anyone outside this repo; the prompt is what a person answers.
    expect(questionFor("kju-is")).toContain("Kim Jong Un");
    expect(questionTitle("kju-is")).toBe("What do you think of Kim Jong Un?");
  });

  it("falls back to the domain for a subject nobody has written a prompt for", () => {
    expect(questionFor("acme-alumni")).toBe("Your answer for acme-alumni (a few words, permanent)");
    // A heading drops the parenthetical; a form label keeps it.
    expect(questionTitle("acme-alumni")).toBe("Your answer for acme-alumni");
  });
});
