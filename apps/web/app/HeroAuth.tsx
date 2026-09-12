"use client";
import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";

/**
 * The two doors on the landing page. Both open the same Privy sign-in: an account is made on first
 * sign-in, so "sign up" and "log in" differ only in what the visitor thinks they are doing. Signed in,
 * the pair becomes the way to their page.
 */
export function HeroAuth() {
  const { ready, authenticated, login } = usePrivy();
  if (!ready) return null;
  if (authenticated) {
    return (
      <p className="row" data-testid="hero-auth">
        <Link href="/me" className="button primary" data-testid="hero-me">
          Your page →
        </Link>
      </p>
    );
  }
  return (
    <p className="row" data-testid="hero-auth">
      <button type="button" className="primary" onClick={login} data-testid="hero-signup">
        Sign up
      </button>
      <button type="button" onClick={login} data-testid="hero-login">
        Log in
      </button>
    </p>
  );
}
