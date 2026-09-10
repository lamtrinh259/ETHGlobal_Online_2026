import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InviteTerms } from "@/app/vouch/[handle]/InviteTerms";

describe("what an invitation asks of the writer", () => {
  it("says nothing when nothing was asked, which is the common case", () => {
    const { container } = render(<InviteTerms candidate="alice" requires={[]} attested={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names what the candidate asked for, and confirms it is met", () => {
    render(
      <InviteTerms candidate="alice" requires={["linkedin.com"]} attested={["linkedin.com", "x.com"]} />
    );
    expect(screen.getByTestId("invite-terms")).toHaveTextContent("linkedin.com");
    expect(screen.getByTestId("invite-terms")).toHaveTextContent(/asked for/i);
    expect(screen.getByTestId("term-linkedin.com").className).toMatch(/done/);
  });

  it("warns that the reference will not count as asked for, without blocking it", () => {
    // Anyone may refer anyone, so an unmet requirement is a fact about the reference and never a wall.
    // Saying nothing would let someone publish and wonder why it came out unsolicited.
    render(<InviteTerms candidate="alice" requires={["mit.edu"]} attested={["x.com"]} />);
    const terms = screen.getByTestId("invite-terms");
    expect(terms).toHaveTextContent(/unsolicited/i);
    expect(screen.getByTestId("term-mit.edu").className).toMatch(/todo/);
    // No wording that suggests the writer is barred.
    expect(terms).not.toHaveTextContent(/cannot write|not allowed|refused/i);
  });

  it("marks each requirement separately, so a writer sees which one is missing", () => {
    render(<InviteTerms candidate="alice" requires={["mit.edu", "github.com"]} attested={["github.com"]} />);
    expect(screen.getByTestId("term-github.com").className).toMatch(/done/);
    expect(screen.getByTestId("term-mit.edu").className).toMatch(/todo/);
  });
});
