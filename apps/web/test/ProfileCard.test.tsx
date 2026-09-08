import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProfileCard } from "@/app/ProfileCard";
import type { Profile } from "@/lib/profile";

const profile: Profile = {
  handle: "alice",
  identity: undefined,
  wallet: "0xEE4811b9462956C9C3535E79c08776D769CA9F3a",
  answers: [
    {
      domain: "kju-is",
      name: "alice.kju-is.ketsuban.eth",
      answer: "terrible dictator",
      status: "active",
      expiresAt: "2026-10-08T09:14:22.000Z",
    },
  ],
  links: [{ domain: "x", optedIn: true, commitment: "0x01" }],
  humanity: null,
  checks: [
    { id: "identity", label: "Claimed name", ok: true, detail: "alice.ketsuban.eth → 0xEE48" },
    { id: "answer:kju-is", label: "Answered kju-is", ok: false, detail: "no live answer" },
  ],
  complete: false,
  warning: "This is not identity verification.",
};

describe("ProfileCard", () => {
  it("renders checks with marks, answers, masked links and the warning", () => {
    render(<ProfileCard p={{ ...profile, identity: {} as never }} rootParent="ketsuban.eth" />);
    expect(screen.getByRole("heading", { name: "alice.ketsuban.eth" })).toBeInTheDocument();
    expect(screen.getByTestId("completeness")).toHaveTextContent("incomplete");
    const items = screen.getByTestId("checks").querySelectorAll("li");
    expect(items[0]).toHaveClass("ok");
    expect(items[0]).toHaveTextContent("Claimed name");
    expect(items[1]).toHaveClass("no");
    expect(items[1]).toHaveTextContent("no live answer");
    expect(screen.getByTestId("answers")).toHaveTextContent("terrible dictator");
    expect(screen.getByTestId("answers")).toHaveTextContent("2026-10-08 09:14Z");
    expect(screen.getByTestId("links")).toHaveTextContent("masked");
    expect(screen.getByTestId("humanity")).toHaveTextContent("not attested");
    expect(screen.getByRole("note")).toHaveTextContent(profile.warning);
  });

  it("renders an unclaimed page", () => {
    render(
      <ProfileCard p={{ ...profile, wallet: null, answers: [], links: [] }} rootParent="ketsuban.eth" />
    );
    expect(screen.getByText("unclaimed")).toBeInTheDocument();
    expect(screen.queryByTestId("answers")).toBeNull();
    expect(screen.getByText("none")).toBeInTheDocument();
  });
});
