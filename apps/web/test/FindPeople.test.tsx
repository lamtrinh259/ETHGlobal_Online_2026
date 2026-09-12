import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

/**
 * Regression: the subject row on the landing page is the subject's own page in miniature. Its avatar,
 * name and description come from the records on the subject's name — Multipass, through the API —
 * and it opens the subject page at /p/<handle>, the same page every other row opens.
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/app/providers", () => ({
  useWebConfig: () => ({ apiUrl: "http://api.test", attestUrl: "http://api.test", instances: [], chainId: 1 }),
}));
vi.mock("@/lib/hooks", async (orig) => ({
  ...(await orig<typeof import("@/lib/hooks")>()),
  apiFor: () => ({ people: vi.fn(async () => ({ people: [] })), who: vi.fn() }),
}));

const { FindPeople } = await import("@/app/FindPeople");
const show = (subjects: Parameters<typeof FindPeople>[0]["subjects"]) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <FindPeople subjects={subjects} />
    </QueryClientProvider>
  );

const kim = {
  domain: "kju-is",
  parentName: "kju-is.ketsuban.eth",
  title: "What do you think of Kim Jong Un?",
  name: "Kim Jong Un",
  about: "Supreme Leader of the DPRK since 2011.",
  avatar: "data:image/png;base64,iVBORw0KGgo=",
  answers: 2,
};

describe("the subject row on the landing page", () => {
  it("renders the subject's avatar, name and description from its records, and opens /p/<handle>", () => {
    show([kim]);
    const row = screen.getByTestId("pinned");
    expect(row.querySelector("a")?.getAttribute("href")).toBe("/p/kju-is");
    expect(row.textContent).toContain("Kim Jong Un");
    expect(row.textContent).toContain("Supreme Leader of the DPRK since 2011.");
    expect(row.textContent).toContain("2 answers");
    const img = row.querySelector("img[data-testid='pinned-avatar']");
    expect(img?.getAttribute("src")).toBe(kim.avatar);
  });

  it("keeps its shape when the records are not there yet: the question stands in for the name", () => {
    show([{ ...kim, name: undefined, about: undefined, avatar: undefined }]);
    const row = screen.getByTestId("pinned");
    expect(row.querySelector("a")?.getAttribute("href")).toBe("/p/kju-is");
    expect(row.textContent).toContain("What do you think of Kim Jong Un?");
    expect(row.querySelector("img[data-testid='pinned-avatar']")).toBeNull();
  });
});
