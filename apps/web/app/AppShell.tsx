"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ThemeToggle } from "./ThemeToggle";
import { waveChars } from "./ui";

const NAV = [
  { href: "/claim", label: "Claim" },
  { href: "/vouch", label: "Vouch" },
  { href: "/verify", label: "Verify" },
  { href: "/me", label: "Me" },
];

/** A nav entry is active on its own route and its sub-routes; /verify also owns /p and /v pages. */
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
  return (
    <div className="sh-root">
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
