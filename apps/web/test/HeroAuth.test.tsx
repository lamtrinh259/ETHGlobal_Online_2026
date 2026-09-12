import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const privy = { ready: true, authenticated: false, login: vi.fn() };
vi.mock("@privy-io/react-auth", () => ({
  useIdentityToken: () => ({ identityToken: null }), usePrivy: () => privy }));

const { HeroAuth } = await import("@/app/HeroAuth");

describe("the doors on the landing page", () => {
  it("offers sign up and log in to a visitor, both opening the same sign-in", () => {
    render(<HeroAuth />);
    fireEvent.click(screen.getByTestId("hero-signup"));
    fireEvent.click(screen.getByTestId("hero-login"));
    expect(privy.login).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId("hero-me")).toBeNull();
  });

  it("leads someone signed in to their page instead", () => {
    privy.authenticated = true;
    render(<HeroAuth />);
    expect(screen.getByTestId("hero-me")).toHaveAttribute("href", "/me");
    expect(screen.queryByTestId("hero-signup")).toBeNull();
    privy.authenticated = false;
  });
});
