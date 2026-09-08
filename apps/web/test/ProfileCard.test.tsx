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
  vouches: [
    {
      voucher: "bob",
      voucherName: "bob.ketsuban.eth",
      wallet: "0x1",
      statement: "worked together 2019-22",
      validUntil: "2027-01-01T00:00:00.000Z",
      nonce: "1",
      live: true,
    },
    {
      voucher: "carol",
      voucherName: null,
      wallet: "0x2",
      statement: "old",
      validUntil: "2025-01-01T00:00:00.000Z",
      nonce: "1",
      live: false,
    },
  ],
  checks: [
    { id: "identity", label: "Claimed name", ok: true, detail: "alice.ketsuban.eth → 0xEE48" },
    { id: "answer:kju-is", label: "Answered kju-is", ok: false, detail: "no live answer" },
  ],
  complete: false,
  warning: "This is not identity verification.",
};

describe("ProfileCard", () => {
  it("renders checks with marks, answers, masked links and the warning", () => {
    render(
      <ProfileCard
        p={{
          ...profile,
          identity: {
            profile: {
              avatar: "https://img.example/a.png",
              description: "prof of maths",
              url: "https://alice.example",
              email: null,
            },
          } as never,
        }}
        rootParent="ketsuban.eth"
      />
    );
    expect(screen.getByTestId("ens-profile")).toHaveTextContent("prof of maths");
    expect(screen.getByRole("link", { name: "https://alice.example" })).toHaveAttribute(
      "href",
      "https://alice.example"
    );
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
    const vouches = screen.getByTestId("vouches").querySelectorAll("li");
    expect(vouches).toHaveLength(2);
    expect(vouches[0]).toHaveClass("live");
    expect(vouches[0]).toHaveTextContent("bob.ketsuban.eth");
    expect(vouches[0]).toHaveTextContent("worked together 2019-22");
    expect(vouches[1]).toHaveClass("expired");
    expect(vouches[1]).toHaveTextContent("carol");
    expect(screen.getByRole("note")).toHaveTextContent(profile.warning);
  });

  it("shows the policy line, the disclosure badge and links vouchers to their own page", () => {
    render(
      <ProfileCard
        p={{
          ...profile,
          links: [{ domain: "x", optedIn: true, disclosed: { handle: "alice_x", platformId: "1" } }],
        }}
        rootParent="ketsuban.eth"
        policy={{ requiredAnswers: ["kju-is"], minLinks: 1, requireHumanity: true, minVouches: 2 }}
      />
    );
    expect(screen.getByTestId("policy-line")).toHaveTextContent(
      "Policy: answers for kju-is · ≥1 linked account · ≥2 live references · humanity attested"
    );
    expect(screen.getByTestId("links")).toHaveTextContent("@alice_x");
    expect(screen.getByTestId("disclosed")).toHaveTextContent("disclosed to you by the candidate");
    const voucherLink = screen.getByTestId("vouches").querySelector("a");
    expect(voucherLink).toHaveAttribute("href", "/p/bob");
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
