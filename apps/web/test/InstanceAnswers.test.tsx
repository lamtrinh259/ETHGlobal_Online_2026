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
    expect(screen.getByTestId("head-url")).toHaveAttribute(
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

describe("a subject page reads as a profile", () => {
  it("leads with the picture, the description and the link, not with a record that is not there", () => {
    // `no record` described the wrong thing: this name is a page about a subject, and whether some
    // person holds the label is beside the point.
    render(
      <InstanceAnswers
        data={{ ...data, records: { ...data.records!, avatar: "https://example.test/kju.png" } }}
      />
    );
    const card = screen.getByTestId("instance-answers");
    expect(screen.getByTestId("head-avatar")).toHaveAttribute("src", "https://example.test/kju.png");
    expect(card).toHaveTextContent("kju-is.ketsuban.eth");
    expect(screen.getByTestId("head-url")).toBeInTheDocument();
    // The answers are still there, under their own heading rather than as the page's subject.
    expect(card).toHaveTextContent("Answers");
  });
});

describe("where the profile's text comes from", () => {
  it("falls back to what ENS itself returned, when the attester has none", () => {
    // The attester reads through the resolver the factory recorded; ENS reads through the one the
    // registry names. When those differ the page still has the answer, because it asked ENS too.
    render(
      <InstanceAnswers
        data={{ ...data, description: null, records: undefined }}
        texts={{ description: "Kim Jong Un, Supreme Leader of North Korea.", url: "https://t.example" }}
      />
    );
    const card = screen.getByTestId("instance-answers");
    expect(card).toHaveTextContent("Supreme Leader");
    expect(screen.getByTestId("head-url")).toHaveAttribute("href", "https://t.example");
  });

  it("prefers what the attester read, which is the same value by a shorter path", () => {
    render(<InstanceAnswers data={data} texts={{ description: "stale", url: "" }} />);
    expect(screen.getByTestId("instance-answers")).toHaveTextContent("Answering tests affiliation");
  });
});

describe("naming a page about a subject", () => {
  it("leads with who it is about, keeping the ENS name as the smaller line", () => {
    // `kju-is.ketsuban.eth` says what the name is, not who it is about. Both belong, in that order.
    render(<InstanceAnswers data={{ ...data, records: { ...data.records!, name: "Kim Jong Un" } }} />);
    const card = screen.getByTestId("instance-answers");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Kim Jong Un");
    expect(card).toHaveTextContent("kju-is.ketsuban.eth");
  });

  it("falls back to the ENS name when nobody has said who it is about", () => {
    render(<InstanceAnswers data={data} />);
    expect(screen.getByTestId("instance-answers").querySelector("h2")).toHaveTextContent(
      "kju-is.ketsuban.eth"
    );
  });

  it("shows a placeholder where there is no picture, so the page keeps its shape", () => {
    // Without one the heading sat alone and the page read as broken rather than as unillustrated.
    render(<InstanceAnswers data={data} />);
    expect(screen.getByTestId("head-avatar")).toBeInTheDocument();
  });
});
