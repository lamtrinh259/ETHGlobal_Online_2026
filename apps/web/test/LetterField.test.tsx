import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LetterField, letterBytes } from "@/app/vouch/[handle]/LetterField";

/**
 * A reference is a title and a body. The title is written into the name itself and the body is not,
 * and which of the two is happening changes with its length — so the field says so as it is typed,
 * rather than after the wallet has been asked.
 */
describe("the body of a reference", () => {
  const show = (value: string) => render(<LetterField value={value} onChange={vi.fn()} candidate="alice" />);

  it("says a short letter goes on chain whole", () => {
    show("worked with them for years");
    expect(screen.getByTestId("letter-count")).toHaveTextContent("goes on chain whole");
  });

  it("says a long one is kept by its hash instead", () => {
    show("x".repeat(700));
    expect(screen.getByTestId("letter-count")).toHaveTextContent("kept by its hash");
  });

  it("counts bytes, not characters, because that is what the limit is in", () => {
    // One emoji is four bytes; a count of characters would promise room that is not there.
    expect(letterBytes("🙂")).toBe(4);
    show("🙂");
    expect(screen.getByTestId("letter-count")).toHaveTextContent("4 bytes");
  });

  it("explains where the text ends up without spending a paragraph on it", () => {
    show("");
    expect(screen.getByTestId("hint")).toHaveAttribute("title", expect.stringContaining("hash"));
  });

  it("reports what was typed", () => {
    const onChange = vi.fn();
    render(<LetterField value="" onChange={onChange} candidate="alice" />);
    fireEvent.change(screen.getByLabelText("letter"), { target: { value: "hello" } });
    expect(onChange).toHaveBeenCalledWith("hello");
  });
});
