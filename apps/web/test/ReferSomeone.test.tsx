import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/providers", () => ({
  useWebConfig: () => ({
    apiUrl: "http://api.test",
    attestUrl: "http://api.test",
    instances: [{ domain: "ketsuban", parentName: "ketsuban.eth", parentLabel: "ketsuban" }],
  }),
}));

const { ReferSomeone, POPULAR_ASKS } = await import("@/app/me/ReferSomeone");

describe("referring someone", () => {
  it("takes a handle and sends you to write the reference, invited or not", () => {
    const go = vi.fn();
    render(<ReferSomeone onGo={go} />);
    fireEvent.change(screen.getByTestId("refer-handle"), { target: { value: "Bob" } });
    fireEvent.click(screen.getByTestId("refer-go"));
    // Lowercased, because a handle is a label: `Bob` and `bob` are the same person.
    expect(go).toHaveBeenCalledWith("bob");
  });

  it("will not send you to write a reference for nobody", () => {
    render(<ReferSomeone onGo={vi.fn()} />);
    expect(screen.getByTestId("refer-go")).toBeDisabled();
  });

  it("says plainly that an invitation is not needed", () => {
    render(<ReferSomeone onGo={vi.fn()} />);
    expect(screen.getByTestId("refer-someone")).toHaveTextContent(/anyone/i);
  });

  it("offers the references people are commonly asked to give", () => {
    // A blank box asks the visitor to invent something; a short list of real asks does not.
    render(<ReferSomeone onGo={vi.fn()} />);
    const asks = screen.getByTestId("popular-asks");
    expect(POPULAR_ASKS.length).toBeGreaterThan(0);
    for (const ask of POPULAR_ASKS) expect(asks).toHaveTextContent(ask.label);
  });

  it("includes the question this deployment was built around", () => {
    // KJU is the subject instance this deployment ships with; it belongs in the list by name.
    expect(POPULAR_ASKS.some((a) => /kim jong un/i.test(a.label))).toBe(true);
  });

  it("fills the statement from a popular ask rather than making it up", () => {
    const go = vi.fn();
    render(<ReferSomeone onGo={go} />);
    fireEvent.change(screen.getByTestId("refer-handle"), { target: { value: "bob" } });
    fireEvent.click(screen.getByTestId(`ask-${POPULAR_ASKS[0].id}`));
    expect(go).toHaveBeenCalledWith("bob", POPULAR_ASKS[0]);
  });
});

describe("carrying a popular ask through to the reference", () => {
  it("turns an ask id back into the prompt the writer answers", async () => {
    const { askById } = await import("@/app/me/ReferSomeone");
    // The link carries the id; the vouch page has to recover what it means without guessing.
    expect(askById("kju-is")?.label).toMatch(/kim jong un/i);
    expect(askById("worked-together")?.placeholder).toBe("CTO at Acme 2019-22");
    // An id nobody offers is not an error: the writer gets the plain form.
    expect(askById("made-up")).toBeUndefined();
    expect(askById(undefined)).toBeUndefined();
  });
});
