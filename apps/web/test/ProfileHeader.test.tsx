import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProfileHeader } from "@/app/me/ProfileHeader";
import { profileScore } from "@/lib/score";

const scored = profileScore({
  human: false,
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

  it("hands the check to whatever can actually run it, and asks nobody twice", () => {
    // The header knows a fact about a person, not how World ID works. A deployment with no World app
    // configured passes nothing and keeps the disabled button, which is why the fallback stays.
    const cta = <button data-testid="humanity-cta">Prove you are one person</button>;
    header({ humanityCta: cta });
    expect(screen.getByTestId("humanity-cta")).toBeEnabled();

    // And once it is proved there is nothing left to ask, whoever supplied the button.
    header({ humanity: { level: "orb", until: null }, humanityCta: cta });
    expect(screen.queryAllByTestId("humanity-cta")).toHaveLength(1);
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

/**
 * The score ring is a to-do list: each part it marks missing links to where that part is earned. A
 * link to an anchor nothing renders looks like a dead control, and the person is left with a number
 * telling them what is wrong and no way to act on it.
 */
describe("the anchor the score links to", () => {
  it("exists where humanity is earned", () => {
    const { container } = render(
      <ProfileHeader
        name="alice.ketsuban.eth"
        handle="alice"
        humanity={null}
        score={scored.score}
        parts={scored.parts}
        onClaim={() => {}}
      />
    );
    expect(container.querySelector("#humanity")).not.toBeNull();
    // And the part that points at it is the one the ring shows as missing.
    expect(scored.parts.find((p) => p.id === "humanity")?.done).toBe(false);
  });
});

/**
 * Everything on the dashboard is machinery for producing one page somebody else reads, and there was
 * no way from it to look at that page: the owner could see their score, their accounts and their
 * references, and not the thing a verifier opens.
 */
describe("seeing your own page", () => {
  it("links to it once the name is held", () => {
    header();
    expect(screen.getByTestId("my-public-page").querySelector("a")).toHaveAttribute("href", "/p/alice");
  });

  it("offers nothing while there is no page to see", () => {
    // Nobody holds the name, so `/p/<handle>` is a page about a name rather than about this person.
    header({ name: undefined, handle: undefined });
    expect(screen.queryByTestId("my-public-page")).toBeNull();
  });
});

describe("the wallet behind the page", () => {
  it("shows the embedded wallet's address, with a copy and a link to the explorer", () => {
    header({ wallet: "0xEE4811b9462956C9C3535E79c08776D769CA9F3a", chainId: 11155111 });
    const row = screen.getByTestId("my-wallet");
    expect(row.textContent).toContain("0xEE4811b9462956C9C3535E79c08776D769CA9F3a");
    expect(row.querySelector("a")?.getAttribute("href")).toBe(
      "https://sepolia.etherscan.io/address/0xEE4811b9462956C9C3535E79c08776D769CA9F3a"
    );
    expect(screen.getByRole("button", { name: /copy/i })).toBeInTheDocument();
  });

  it("says nothing about a wallet that is not there yet", () => {
    header({});
    expect(screen.queryByTestId("my-wallet")).toBeNull();
  });
});
