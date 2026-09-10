import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InstanceAnswers } from "@/app/InstanceAnswers";

const data = {
  domain: "kju-is",
  parentName: "kju-is.ketsuban.eth",
  description: "Answering tests affiliation with North Korean operators.",
  records: {
    description: "Answering tests affiliation with North Korean operators.",
    url: "https://en.wikipedia.org/wiki/Kim_Jong_Un",
    avatar: "",
  },
  answers: [
    {
      handle: "alice",
      ensName: "alice.kju-is.ketsuban.eth",
      answer: "terrible dictator",
      validUntil: "2027-01-01T00:00:00.000Z",
    },
  ],
};

describe("a name people answer under", () => {
  it("shows what was said, and by which name", () => {
    render(<InstanceAnswers data={data} />);
    expect(screen.getByTestId("instance-answers")).toHaveTextContent("terrible dictator");
    expect(screen.getByTestId("answer-alice")).toHaveTextContent("alice.kju-is.ketsuban.eth");
  });

  it("carries the purpose the name itself publishes", () => {
    render(<InstanceAnswers data={data} />);
    expect(screen.getByTestId("instance-answers")).toHaveTextContent(/North Korean/);
  });

  it("says who the page is about, and links to where that came from", () => {
    // A page for someone who has claimed nothing is only worth reading if it says who they are.
    render(<InstanceAnswers data={data} />);
    const card = screen.getByTestId("instance-answers");
    expect(card).toHaveTextContent("Answering tests affiliation");
    expect(screen.getByTestId("about-url")).toHaveAttribute(
      "href",
      "https://en.wikipedia.org/wiki/Kim_Jong_Un"
    );
  });

  it("says nobody has answered rather than reading as though the name were broken", () => {
    // "No record" was the old answer here, and it hid the fact that this name is for answering at all.
    render(
      <InstanceAnswers
        data={{ ...data, answers: [], description: null, records: { description: "", url: "", avatar: "" } }}
      />
    );
    expect(screen.getByTestId("instance-answers")).toHaveTextContent(/nobody has answered/i);
  });
});
