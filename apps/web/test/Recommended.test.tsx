import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Recommended } from "@/app/me/Recommended";

const rows = [
  { domain: "kju-is", ensName: "alice.kju-is.ketsuban.eth", answer: "", validUntil: null },
  {
    domain: "other",
    ensName: "alice.other.ketsuban.eth",
    answer: "yes",
    validUntil: "2027-03-01T00:00:00.000Z",
  },
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

  it("says how long an answer stands, because it does not stand forever", () => {
    // A record expires; an answer with no date reads as permanent and is not.
    render(<Recommended rows={rows} onAnswer={vi.fn()} />);
    expect(screen.getByTestId("answer-other")).toHaveTextContent("2027-03-01");
    // An unanswered question has no date to give, and must not invent one.
    expect(screen.getByTestId("answer-kju-is")).not.toHaveTextContent("2027");
  });

  it("links to the question's own name, where its purpose is published", () => {
    // The instance name carries a description saying what answering it is for, readable by any ENS
    // client. That is the thing to link to, not this page.
    render(<Recommended rows={rows} onAnswer={vi.fn()} />);
    const link = screen.getByTestId("about-kju-is");
    expect(link).toHaveAttribute("href", "/v/kju-is.ketsuban.eth");
  });

  it("shows nothing at all when this deployment asks no questions", () => {
    const { container } = render(<Recommended rows={[]} onAnswer={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
