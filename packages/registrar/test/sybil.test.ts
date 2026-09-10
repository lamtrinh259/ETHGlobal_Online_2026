import { describe, expect, it } from "vitest";
import { sybilScore, sybilBand, HUMAN_REFERRER_FLOOR } from "../src/sybil.js";

/**
 * The score answers "how expensive is this to fake", not "is this person who they say". The tests are
 * written as the shapes an attacker would actually build, because that is what the weights are for.
 */
const of = (over: Partial<Parameters<typeof sybilScore>[0]> = {}) =>
  sybilScore({ human: false, referrers: [], accounts: 0, ...over });

const human = (mutual = false) => ({ human: true, mutual });
const nobody = (mutual = false) => ({ human: false, mutual });

describe("how hard a name would be to fake", () => {
  it("gives nothing to a name with nothing behind it", () => {
    const { score, band } = of();
    expect(score).toBe(0);
    expect(band).toBe("weak");
  });

  it("is unimpressed by accounts alone, because one person opens ten", () => {
    // The whole of the cheapest signal is still worth less than a single proof of humanity.
    const { score } = of({ accounts: 10 });
    expect(score).toBe(15);
    expect(of({ human: true }).score).toBeGreaterThan(score);
  });

  it("counts a ring of accounts referring each other for almost nothing", () => {
    // Three names, one person, all mutual, none of them human: the cheapest structure there is.
    const ring = of({ referrers: [nobody(true), nobody(true), nobody(true)], accounts: 3 });
    expect(ring.score).toBe(15);
    expect(ring.band).toBe("weak");
  });

  it("rates the same three references highly when the people are proven and independent", () => {
    const real = of({ human: true, referrers: [human(), human(), human()], accounts: 3 });
    expect(real.score).toBe(100);
    expect(real.band).toBe("strong");
  });

  it("docks a mutual pair without erasing what else is there", () => {
    const straight = of({ human: true, referrers: [human(), human()] });
    const backScratch = of({ human: true, referrers: [human(true), human(true)] });
    expect(backScratch.score).toBeLessThan(straight.score);
    // Their proofs still cost what they cost; only the independence part is gone.
    expect(backScratch.parts.find((p) => p.id === "independence")!.earned).toBe(0);
    expect(backScratch.parts.find((p) => p.id === "vouched-by-humans")!.earned).toBeGreaterThan(0);
  });

  it("treats having no references as nothing to be independent of, not as independence", () => {
    const part = of({ human: true }).parts.find((p) => p.id === "independence")!;
    expect(part.earned).toBe(0);
    expect(part.detail).toBe("no references yet");
  });

  it("stops counting referrers past the point where farming them would start", () => {
    const many = Array.from({ length: 12 }, () => human());
    const enough = Array.from({ length: HUMAN_REFERRER_FLOOR }, () => human());
    expect(of({ referrers: many }).score).toBe(of({ referrers: enough }).score);
  });

  it("says how many referrers proved it, not just how many there were", () => {
    const part = of({ referrers: [human(), nobody(), nobody()] }).parts.find(
      (p) => p.id === "vouched-by-humans"
    )!;
    expect(part.detail).toBe("1 of 3 referrers proved");
  });

  it("names a band so nobody has to decide what 61 means", () => {
    expect(sybilBand(0)).toBe("weak");
    expect(sybilBand(34)).toBe("weak");
    expect(sybilBand(35)).toBe("moderate");
    expect(sybilBand(69)).toBe("moderate");
    expect(sybilBand(70)).toBe("strong");
  });

  it("never exceeds what the parts are worth", () => {
    const max = of({ human: true, referrers: Array.from({ length: 9 }, () => human()), accounts: 9 });
    expect(max.score).toBe(100);
    expect(max.parts.reduce((n, p) => n + p.weight, 0)).toBe(100);
  });
});
