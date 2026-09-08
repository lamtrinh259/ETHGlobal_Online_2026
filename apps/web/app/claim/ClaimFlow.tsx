"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import type { Address } from "viem";
import { AttestFlow } from "@/app/AttestFlow";
import { useWebConfig } from "@/app/providers";
import { shareSnippet } from "@/lib/profile";
import { apiFor, useWalletDashboard } from "@/lib/hooks";
import { claimProgress } from "@/lib/journey";
import { CopyButton } from "@/app/CopyButton";

/**
 * Candidate journey: claim the root name, then one answer per subject instance, then share.
 * Progress is read from the wallet's live records, so a returning candidate lands on the next
 * unanswered subject instead of re-claiming. The publishing mechanics are AttestFlow.
 */
export function ClaimFlow() {
  const config = useWebConfig();
  const [root, ...subjects] = config.instances;
  const api = useMemo(() => apiFor(config), [config]);
  const { authenticated } = usePrivy();
  const { wallets } = useWallets();
  const wallet = (wallets.find((w) => w.walletClientType === "privy") ?? wallets[0])?.address as
    Address | undefined;
  const dash = useWalletDashboard(api, authenticated ? wallet : undefined);
  const onChain = claimProgress(dash.data, config.instances);

  const [claimed, setClaimed] = useState<string>();
  const [done, setDone] = useState<Set<string>>(new Set());
  const handle = claimed ?? onChain.handle;
  const answered = (d: string) => done.has(d) || onChain.answered.has(d);
  const step = !handle ? 0 : 1 + subjects.findIndex((s) => !answered(s.domain));
  const current = !handle ? root : subjects.find((s) => !answered(s.domain));
  const finished = !!handle && subjects.every((s) => answered(s.domain));
  const siteUrl = typeof window === "undefined" ? "" : window.location.origin;
  const loading = authenticated && !!wallet && dash.isPending;

  return (
    <>
      <ol className="stepper" aria-label="Progress">
        <li className={handle ? "done" : "now"}>Claim {root?.parentName}</li>
        {subjects.map((s) => (
          <li
            key={s.domain}
            className={answered(s.domain) ? "done" : current?.domain === s.domain ? "now" : ""}
          >
            Answer {s.domain}
          </li>
        ))}
        <li className={finished ? "now" : ""}>Share</li>
      </ol>

      {loading && <p className="muted">reading your records…</p>}

      {!loading && !finished && current && (
        <AttestFlow
          key={current.domain}
          fixedDomain={current.domain}
          fixedHandle={handle}
          title={step === 0 ? "Your handle" : `Question: ${current.domain}`}
          answerLabel={step === 0 ? undefined : questionFor(current.domain)}
          onPublished={({ handle: h, domain }) => {
            if (!handle) setClaimed(h);
            if (domain !== root?.domain) setDone((d) => new Set(d).add(domain));
          }}
        />
      )}

      {!loading && finished && handle && root && (
        <>
          <section className="card" data-testid="share">
            <h2>Share your page</h2>
            <p>
              <a href={`/p/${handle}`}>
                {siteUrl}/p/{handle}
              </a>
            </p>
            <p>
              <code>{shareSnippet(handle, siteUrl, root.parentName)}</code>
            </p>
            <CopyButton text={shareSnippet(handle, siteUrl, root.parentName)} label="Copy for a cold email" />
          </section>
          <section className="card" data-testid="next-steps">
            <h2>Make it count</h2>
            <ul className="checks">
              <li>
                <Link href={`/vouch/${handle}`}>Ask for references</Link> — send <code>/vouch/{handle}</code>{" "}
                to people who can speak for you. Every vouch is a verified human staking their own permanent
                name.
              </li>
              <li>
                <Link href="/me">Link a work account</Link> — X, GitHub or Telegram, masked unless you share
                the view code. Verifiers count live links.
              </li>
              <li>
                <Link href="/me">Fill your ENS profile</Link> — avatar, description, website. Any ENS client
                shows them on{" "}
                <code>
                  {handle}.{root.parentName}
                </code>
                .
              </li>
              <li>
                <Link href="/me">
                  Own <code>{handle}.eth</code>?
                </Link>{" "}
                Alias it so{" "}
                <code>
                  {root.parentLabel}.{handle}.eth
                </code>{" "}
                resolves to the same records.
              </li>
            </ul>
          </section>
        </>
      )}
    </>
  );
}

/** The prompt shown for a subject instance; a deployment argument in spirit, a table for now. */
export function questionFor(domain: string): string {
  const known: Record<string, string> = {
    "kju-is": "What do you think of Kim Jong Un? (≤31 bytes, permanent)",
  };
  return known[domain] ?? `Your answer for ${domain} (≤31 bytes, permanent)`;
}
