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
