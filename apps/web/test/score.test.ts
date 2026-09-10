import { describe, expect, it } from "vitest";
import { profileScore, type ScoreInput } from "@/lib/score";

const empty: ScoreInput = {
  hasName: false,
  accounts: 0,
  profile: { avatar: "", description: "", url: "" },
  references: 0,
};

describe("how complete a profile is", () => {
  it("is zero for someone who has done nothing, and never negative", () => {
    expect(profileScore(empty).score).toBe(0);
  });

  it("is a hundred once everything a person can do is done", () => {
    // Anything a person cannot yet do must not hold the number down: a score that cannot reach 100
    // reads as a broken product rather than as an incomplete profile.
    const done: ScoreInput = {
      hasName: true,
      accounts: 2,
      profile: { avatar: "a", description: "b", url: "c" },
      references: 3,
    };
    expect(profileScore(done).score).toBe(100);
  });

  it("weights a name and references above the parts that cost nothing", () => {
    const named = profileScore({ ...empty, hasName: true }).score;
    const oneField = profileScore({ ...empty, profile: { avatar: "a", description: "", url: "" } }).score;
    expect(named).toBeGreaterThan(oneField);
    // Three references is the floor a verifier asks for, so it is worth the most.
    expect(profileScore({ ...empty, references: 3 }).score).toBeGreaterThan(named);
  });

  it("counts references up to the floor and no further, so nobody farms the number", () => {
    const three = profileScore({ ...empty, references: 3 }).score;
    expect(profileScore({ ...empty, references: 9 }).score).toBe(three);
  });

  it("names what is left to do, in the order worth doing it", () => {
    const { parts } = profileScore({ ...empty, hasName: true });
    const done = parts.filter((p) => p.done).map((p) => p.id);
    const todo = parts.filter((p) => !p.done).map((p) => p.id);
    expect(done).toContain("name");
    expect(todo).toContain("references");
    // Every part carries its own worth, so the page can show why one matters more than another.
    expect(parts.every((p) => p.weight > 0)).toBe(true);
    expect(parts.reduce((n, p) => n + p.weight, 0)).toBe(100);
  });

  it("gives partial credit rather than all or nothing", () => {
    // One account and one reference is real progress; showing 0 would tell someone they had failed.
    const some = profileScore({ ...empty, accounts: 1, references: 1 }).score;
    expect(some).toBeGreaterThan(0);
    expect(some).toBeLessThan(100);
  });
});
