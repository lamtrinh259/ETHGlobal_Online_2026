import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * Regression: the landing page reads each subject's name, description and avatar off the subject's
 * own name records — what Multipass holds, through the API — and hands all three to the row.
 */
const captured: unknown[] = [];
vi.mock("@/app/FindPeople", () => ({
  FindPeople: (props: { subjects: unknown[] }) => {
    captured.push(props.subjects);
    return null;
  },
}));
vi.mock("@/app/HeroAuth", () => ({ HeroAuth: () => null }));
vi.mock("@/lib/config", () => ({
  loadWebConfig: () => ({
    apiUrl: "http://api.test",
    attestUrl: "http://api.test",
    instances: [
      { domain: "ketsuban", parentName: "ketsuban.eth", parentLabel: "ketsuban" },
      { domain: "kju-is", parentName: "kju-is.ketsuban.eth", parentLabel: "kju-is" },
    ],
  }),
}));
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  createApi: () => ({
    instance: vi.fn(async () => ({
      records: {
        name: "Kim Jong Un",
        description: "Supreme Leader.",
        avatar: "data:image/png;base64,AAAA",
        url: "",
      },
      answers: [{ handle: "peersky" }, { handle: "alice" }],
    })),
  }),
}));

describe("the landing page's subjects", () => {
  it("passes the name, description and avatar read from the subject's records to the row", async () => {
    const { default: Page } = await import("@/app/page");
    render(await Page());
    expect(captured[0]).toEqual([
      expect.objectContaining({
        domain: "kju-is",
        parentName: "kju-is.ketsuban.eth",
        name: "Kim Jong Un",
        about: "Supreme Leader.",
        avatar: "data:image/png;base64,AAAA",
        answers: 2,
      }),
    ]);
  });
});

describe("the landing page's banner", () => {
  it("opens with the logotype, at the top, as an image a reader can name", async () => {
    const { default: Page } = await import("@/app/page");
    render(await Page());
    const banner = screen.getByTestId("hero-banner");
    expect(banner).toHaveAttribute("src", "/banner.jpg");
    expect(banner).toHaveAttribute("alt", "ShibbolETH");
    // Above the headline, not beside or below it.
    expect(
      banner.compareDocumentPosition(screen.getByRole("heading", { level: 1 })) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});
