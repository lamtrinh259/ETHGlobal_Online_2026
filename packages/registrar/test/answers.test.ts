import { describe, expect, it } from "vitest";
import { answerDomain, answerOf, answerSlug } from "../src/answers.js";

describe("an answer as a namespace", () => {
  it("turns what someone wrote into a label a name can hold", () => {
    // The answer becomes a level in the namespace, so it has to survive being a DNS label.
    expect(answerSlug("dictator")).toBe("dictator");
    expect(answerSlug("A Terrible Dictator")).toBe("a-terrible-dictator");
    expect(answerSlug("  spaced  out  ")).toBe("spaced-out");
    expect(answerSlug("no comment!")).toBe("no-comment");
  });

  it("refuses an answer that cannot be a label at all, rather than inventing one", () => {
    // A name nobody could have meant is worse than saying the answer will not fit.
    expect(answerSlug("!!!")).toBeUndefined();
    expect(answerSlug("")).toBeUndefined();
    expect(answerSlug("   ")).toBeUndefined();
  });

  it("keeps the whole domain inside the 31 bytes a Multipass name holds", () => {
    // `<question>:<answer>` is a bytes32 domain name; an answer that overflows it is refused here
    // rather than reverting on chain after someone has signed.
    expect(answerDomain("kju-is", "dictator")).toBe("kju-is:dictator");
    expect(answerDomain("kju-is", "x".repeat(40))).toBeUndefined();
    expect(answerDomain("kju-is", "!!!")).toBeUndefined();
  });

  it("reads the question and the answer back out of a domain", () => {
    // The domain is the linkage Multipass has: everything about where a record lives is in it.
    expect(answerOf("kju-is:dictator")).toEqual({ question: "kju-is", answer: "dictator" });
    // A plain domain is not an answer domain, and must not be mistaken for one.
    expect(answerOf("kju-is")).toBeUndefined();
    expect(answerOf("~alice")).toBeUndefined();
    expect(answerOf("x.com")).toBeUndefined();
  });

  it("round-trips, so what was written is what is read back", () => {
    const domain = answerDomain("kju-is", "A Terrible Dictator")!;
    expect(answerOf(domain)).toEqual({ question: "kju-is", answer: "a-terrible-dictator" });
  });
});
