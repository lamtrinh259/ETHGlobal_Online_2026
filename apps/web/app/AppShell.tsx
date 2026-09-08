"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ThemeToggle } from "./ThemeToggle";
import { useWebConfig } from "./providers";
import { waveChars } from "./ui";

const NAV = [
  { href: "/claim", label: "Claim" },
  { href: "/vouch", label: "Vouch" },
  { href: "/verify", label: "Verify" },
  { href: "/me", label: "Me" },
];

/** A nav entry is active on its own route and its sub-routes; /verify also owns /p and /v pages. */
/** A production page pointed at a loopback API cannot work: NEXT_PUBLIC_API_URL was missing at build time. */
export function apiMisconfigured(apiUrl: string, origin: string): boolean {
  const loopback = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/i;
  return loopback.test(apiUrl) && !loopback.test(origin) && origin !== "";
}

export function isActive(path: string, href: string): boolean {
  if (path === href || path.startsWith(`${href}/`)) return true;
  return href === "/verify" && (path.startsWith("/p/") || path.startsWith("/v/"));
}

function Wordmark() {
  return (
    <span className="wordmark wave">
      {waveChars("ketsuban").map((c, i) => (
        <span key={i} style={{ animationDelay: c.delay }}>
          {c.ch}
        </span>
      ))}
    </span>
  );
}

/** The frame every page wears: wordmark, two-entry nav, theme, build stamp. */
export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const config = useWebConfig();
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return (
    <div className="sh-root">
      {apiMisconfigured(config.apiUrl, origin) && (
        <p className="error" role="alert" data-testid="api-misconfigured">
          This build points at <code>{config.apiUrl}</code>. Set <code>NEXT_PUBLIC_API_URL</code> and{" "}
          <code>NEXT_PUBLIC_ATTEST_URL</code> in the deploy environment and rebuild.
        </p>
      )}
      <header className="sh-top">
        <Link href="/" className="sh-brand" aria-label="Ketsuban home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/mark.svg" alt="" className="sh-logo" width={22} height={22} />
          <Wordmark />
        </Link>
        <nav className="sh-nav" aria-label="Primary">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`sh-navLink ${isActive(path, n.href) ? "sh-on" : ""}`}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <ThemeToggle />
      </header>
      <main className="sh-body">{children}</main>
      <footer className="sh-foot muted">
        build {process.env.NEXT_PUBLIC_BUILD} · every record is permanent · this is not identity verification
      </footer>
    </div>
  );
}
