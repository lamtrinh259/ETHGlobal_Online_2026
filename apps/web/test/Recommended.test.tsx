import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Recommended } from "@/app/me/Recommended";

const rows = [
  { domain: "kju-is", ensName: "alice.kju-is.ketsuban.eth", answer: "" },
  { domain: "other", ensName: "alice.other.ketsuban.eth", answer: "yes" },
];

describe("questions recommended to answer", () => {
  it("asks the question, not the domain it lives in", () => {
    render(<Recommended rows={rows} onAnswer={vi.fn()} />);
    expect(screen.getByTestId("answer-kju-is")).toHaveTextContent("What do you think of Kim Jong Un?");
    expect(screen.getByTestId("answer-kju-is")).not.toHaveTextContent("kju-is.ketsuban.eth · kju-is");
  });

  it("says why answering is worth anything, where the reason is known", () => {
    render(<Recommended rows={rows} onAnswer={vi.fn()} />);
    expect(screen.getByTestId("answer-kju-is")).toHaveTextContent(/North Korean/i);
  });

  it("answers about you, never about somebody else", () => {
    // This is the mistake it exists to prevent: the question is a claim you make about yourself, so
    // it must open the publish flow for your own name and never ask whose account you mean.
    const onAnswer = vi.fn();
    render(<Recommended rows={rows} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByTestId("answer-now-kju-is"));
    expect(onAnswer).toHaveBeenCalledWith("kju-is");
  });

  it("offers to change an answer already given, rather than hiding it", () => {
    render(<Recommended rows={rows} onAnswer={vi.fn()} />);
    expect(screen.getByTestId("answer-other")).toHaveTextContent("yes");
    expect(screen.getByTestId("answer-now-other")).toHaveTextContent(/change/i);
  });

  it("shows nothing at all when this deployment asks no questions", () => {
    const { container } = render(<Recommended rows={[]} onAnswer={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
