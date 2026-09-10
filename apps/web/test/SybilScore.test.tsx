import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SybilScore } from "@/app/SybilScore";
import type { Sybil } from "@/lib/api";

/**
 * The number on its own would be read as a trust rating. It is not one: it says what the account cost
 * to build, not who holds it — so the parts are the content and the number is their summary.
 */
const of = (over: Partial<Sybil> = {}): Sybil => ({
  handle: "alice",
  score: 55,
  band: "moderate",
  parts: [
    {
      id: "humanity",
      label: "Proof of humanity",
      weight: 30,
      earned: 30,
      why: "A nullifier is spent once.",
      detail: "proved",
    },
    {
      id: "independence",
      label: "Independent references",
      weight: 25,
      earned: 0,
      why: "Two names referring each other is the cheapest fake there is.",
      detail: "1 of 1 are mutual",
    },
  ],
  warning: "How expensive this account was to build, not who holds it.",
  ...over,
});

describe("how hard this is to fake", () => {
  it("shows the number with the band that says what it means", () => {
    render(<SybilScore s={of()} />);
    expect(screen.getByTestId("sybil-score")).toHaveTextContent("55");
    expect(screen.getByTestId("sybil-band")).toHaveTextContent("moderate");
  });

  it("gives every part its reason, not just its number", () => {
    render(<SybilScore s={of()} />);
    expect(screen.getByTestId("sybil-humanity")).toHaveTextContent("A nullifier is spent once");
    expect(screen.getByTestId("sybil-independence")).toHaveTextContent("cheapest fake");
    // A part worth nothing still says what it would take to earn it.
    expect(screen.getByTestId("sybil-independence")).toHaveTextContent("1 of 1 are mutual");
  });

  it("keeps the warning visible, because a number beside a name reads as a verdict", () => {
    render(<SybilScore s={of()} />);
    expect(screen.getByRole("note")).toHaveTextContent("not who holds it");
  });

  it("says weak plainly rather than hiding a zero", () => {
    render(<SybilScore s={of({ score: 0, band: "weak" })} />);
    expect(screen.getByTestId("sybil-score")).toHaveTextContent("0");
    expect(screen.getByTestId("sybil-band")).toHaveTextContent("weak");
  });
});
