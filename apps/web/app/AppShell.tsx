"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import build from "@/lib/build-info.json";
import { Preflight } from "./Preflight";
import { ThemeToggle } from "./ThemeToggle";
import { WhoAmI } from "./WhoAmI";
import { useWebConfig } from "./providers";
import { useBodyScrollLock } from "./useBodyScrollLock";
import { useModalEscape } from "./useModalEscape";
import { buildStamp, waveChars } from "./ui";

const NAV = [
  { href: "/me", label: "My profile" },
  { href: "/vouch", label: "Vouch" },
  { href: "/verify", label: "Verify" },
  { href: "/names", label: "Names" },
];

/** A production page pointed at a loopback API cannot work: NEXT_PUBLIC_API_URL was missing at build time. */
export function apiMisconfigured(apiUrl: string, origin: string): boolean {
  const loopback = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/i;
  return loopback.test(apiUrl) && !loopback.test(origin) && origin !== "";
}

/** A nav entry is active on its own route and its sub-routes; /verify also owns /p and /v pages. */
export function isActive(path: string, href: string): boolean {
  if (path === href || path.startsWith(`${href}/`)) return true;
  if (href === "/verify") return path.startsWith("/p/") || path.startsWith("/v/") || path.startsWith("/w/");
  // Claiming is part of the profile now; an old link still highlights the right entry.
  return href === "/me" && path.startsWith("/claim");
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

/**
 * A left sidebar on a wide screen, the same markup as a full-screen drawer on a narrow one (the
 * pattern and breakpoint come from the noolog web app). While the drawer is the modal on top, the
 * page behind it leaves the tab order, the a11y tree and the pointer path.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const config = useWebConfig();
  const [navOpen, setNavOpen] = useState(false);
  const burgerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const prevOpen = useRef(false);
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  useEffect(() => setNavOpen(false), [path]);
  useBodyScrollLock(navOpen);
  useModalEscape(() => setNavOpen(false), navOpen);
  useEffect(() => {
    if (navOpen) closeRef.current?.focus();
    else if (prevOpen.current) burgerRef.current?.focus();
    prevOpen.current = navOpen;
  }, [navOpen]);

  // The closed drawer is `inert` only on mobile: on a wide screen the same <aside> is the sidebar.
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const sync = () => setCompact(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const close = () => setNavOpen(false);

  return (
    <div className="sh-root">
      <header className="sh-mobtop" inert={compact && navOpen ? true : undefined}>
        <button
          ref={burgerRef}
          className="sh-burger"
          aria-label="Menu"
          aria-expanded={navOpen}
          onClick={() => setNavOpen(true)}
        >
          ☰
        </button>
        <Link href="/" className="sh-brand" onClick={close} aria-label="Ketsuban home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/mark.svg" alt="" aria-hidden className="sh-logo" width={22} height={22} />
          <Wordmark />
        </Link>
        {compact && (
          <>
            <WhoAmI />
            <ThemeToggle />
          </>
        )}
      </header>

      <aside
        className={`sh-side ${navOpen ? "sh-sideOpen" : ""}`}
        inert={compact && !navOpen ? true : undefined}
        role={compact && navOpen ? "dialog" : undefined}
        aria-modal={compact && navOpen ? true : undefined}
        aria-label={compact && navOpen ? "Menu" : undefined}
      >
        <button ref={closeRef} className="sh-close" aria-label="Close menu" onClick={close}>
          ✕
        </button>
        <Link href="/" className="sh-brand sh-brandSide" onClick={close} aria-label="Ketsuban home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/mark.svg" alt="" aria-hidden className="sh-logo" width={26} height={26} />
          <Wordmark />
        </Link>
        <nav className="sh-nav" aria-label="Primary">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              onClick={close}
              className={`sh-navLink ${isActive(path, n.href) ? "sh-on" : ""}`}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="sh-sideFoot">
          {!compact && (
            <>
              <WhoAmI />
              <ThemeToggle />
            </>
          )}
          <p className="sh-note muted">
            {buildStamp(build.sha, build.builtAt)} · every record is permanent · this is not identity
            verification
          </p>
        </div>
      </aside>

      <main className="sh-body" inert={compact && navOpen ? true : undefined}>
        {apiMisconfigured(config.apiUrl, origin) && (
          <p className="error" role="alert" data-testid="api-misconfigured">
            This build points at <code>{config.apiUrl}</code>. Set <code>NEXT_PUBLIC_API_URL</code> and{" "}
            <code>NEXT_PUBLIC_ATTEST_URL</code> in the deploy environment and rebuild.
          </p>
        )}
        <Preflight />
        {children}
      </main>
    </div>
  );
}
