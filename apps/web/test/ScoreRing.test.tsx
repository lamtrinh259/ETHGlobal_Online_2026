import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScoreRing } from "@/app/me/ScoreRing";
import { profileScore } from "@/lib/score";

const at = (over: Parameters<typeof profileScore>[0]) => profileScore(over);

describe("the score at the top of a profile", () => {
  it("shows the number and what is still missing", () => {
    const { score, parts } = at({
      hasName: true,
      accounts: 1,
      profile: { avatar: "", description: "", url: "" },
      references: 0,
    });
    render(<ScoreRing score={score} parts={parts} />);
    expect(screen.getByTestId("score")).toHaveTextContent(String(score));
    // Each part is legible on its own, so the number is never just a verdict.
    expect(screen.getByTestId("part-references")).toHaveTextContent("0 of 3");
    expect(screen.getByTestId("part-name")).toHaveTextContent(/claimed/);
  });

  it("marks a finished part apart from an unfinished one", () => {
    const { score, parts } = at({
      hasName: true,
      accounts: 2,
      profile: { avatar: "a", description: "b", url: "c" },
      references: 3,
    });
    render(<ScoreRing score={score} parts={parts} />);
    expect(screen.getByTestId("score")).toHaveTextContent("100");
    expect(screen.getByTestId("part-name").className).toMatch(/done/);
  });

  it("sends you to the step that fixes each part, so the number is a way in", () => {
    // A score that only grades is a verdict. Every part is the next thing to do, so it links to it.
    const { score, parts } = at({
      hasName: false,
      accounts: 0,
      profile: { avatar: "", description: "", url: "" },
      references: 0,
    });
    render(<ScoreRing score={score} parts={parts} />);
    expect(screen.getByTestId("part-name").querySelector("a")).toHaveAttribute("href", "#name");
    expect(screen.getByTestId("part-accounts").querySelector("a")).toHaveAttribute("href", "#accounts");
    expect(screen.getByTestId("part-references").querySelector("a")).toHaveAttribute("href", "#references");
    // The profile lives in the same step as the name, so it must not link somewhere that is not there.
    expect(screen.getByTestId("part-profile").querySelector("a")).toHaveAttribute("href", "#name");
  });

  it("is readable without colour, for anyone who cannot use it", () => {
    const { score, parts } = at({
      hasName: false,
      accounts: 0,
      profile: { avatar: "", description: "", url: "" },
      references: 0,
    });
    render(<ScoreRing score={score} parts={parts} />);
    // A ring alone says nothing to a screen reader; the number has to be spoken.
    expect(screen.getByTestId("score")).toHaveAttribute("aria-label", expect.stringMatching(/0/));
  });
});
