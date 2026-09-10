import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProfileHeader } from "@/app/me/ProfileHeader";
import { profileScore } from "@/lib/score";

const scored = profileScore({
  hasName: true,
  accounts: 1,
  profile: { avatar: "", description: "", url: "" },
  references: 0,
});

const header = (over: Partial<Parameters<typeof ProfileHeader>[0]> = {}) =>
  render(
    <ProfileHeader
      name="alice.ketsuban.eth"
      handle="alice"
      profile={{ avatar: "", description: "", url: "", email: "" }}
      humanity={null}
      score={scored.score}
      parts={scored.parts}
      onClaim={vi.fn()}
      {...over}
    />
  );

describe("the profile header", () => {
  it("is who you are and how far you have got, in one card", () => {
    header({ profile: { avatar: "", description: "infra lead", url: "", email: "" } });
    const card = screen.getByTestId("profile-header");
    expect(card).toHaveTextContent("alice.ketsuban.eth");
    expect(card).toHaveTextContent("infra lead");
    expect(screen.getByTestId("score")).toBeInTheDocument();
  });

  it("says humanity is unverified, and offers the check", () => {
    // It belongs beside the name because it is a fact about the person, not a step in a sequence.
    header();
    expect(screen.getByTestId("humanity")).toHaveTextContent(/unverified/i);
    expect(screen.getByTestId("humanity-cta")).toBeInTheDocument();
  });

  it("says so plainly when the check has been passed", () => {
    header({ humanity: { level: "medium", until: null } });
    expect(screen.getByTestId("humanity")).toHaveTextContent(/verified/i);
    expect(screen.getByTestId("humanity")).not.toHaveTextContent(/unverified/i);
    expect(screen.queryByTestId("humanity-cta")).toBeNull();
  });

  it("carries the social accounts below the rest, as part of who you are", () => {
    header({ accounts: <ul data-testid="accounts-slot" /> });
    const card = screen.getByTestId("profile-header");
    expect(card).toHaveTextContent(/social accounts/i);
    expect(screen.getByTestId("accounts-slot")).toBeInTheDocument();
    // The score links here, so the anchor has to exist on the block it points at.
    expect(card.querySelector("#accounts")).not.toBeNull();
  });

  it("asks for the name first when there is none, because everything hangs off it", () => {
    const onClaim = vi.fn();
    header({ name: undefined, handle: undefined, onClaim });
    expect(screen.getByTestId("claim")).toBeInTheDocument();
    // And nothing pretends to be a profile that cannot exist yet.
    expect(screen.queryByTestId("profile-editor")).toBeNull();
  });
});
