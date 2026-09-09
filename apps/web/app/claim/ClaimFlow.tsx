"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import type { Address } from "viem";
import { AttestFlow } from "@/app/AttestFlow";
import { Step } from "@/app/Step";
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
export function ClaimFlow({ renew }: { renew?: string }) {
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
  const current = !handle ? root : subjects.find((s) => !answered(s.domain));
  const finished = !!handle && subjects.every((s) => answered(s.domain));
  const siteUrl = typeof window === "undefined" ? "" : window.location.origin;
  const loading = authenticated && !!wallet && dash.isPending;
  const renewing = renew ? config.instances.find((i) => i.domain === renew) : undefined;

  if (renewing && handle) {
    return (
      <>
        <p className="muted" data-testid="renewing">
          Renewing{" "}
          <code>
            {handle}.{renewing.parentName}
          </code>
          . A renewal is a fresh record with the next nonce; the old one stays in the history.{" "}
          <Link href="/me">Back to your dashboard</Link>.
        </p>
        <AttestFlow
          key={renewing.domain}
          fixedDomain={renewing.domain}
          fixedHandle={handle}
          title={`Renew ${renewing.domain}`}
          answerLabel={renewing.domain === root?.domain ? undefined : questionFor(renewing.domain)}
        />
      </>
    );
  }

  return (
    <>
      <Step
        n={1}
        title={handle ? `Your name: ${handle}.${root?.parentName}` : "Pick your name"}
        state={handle ? "done" : "now"}
      >
        {handle ? (
          <p className="muted">Yours for as long as you renew it. Everything below hangs off it.</p>
        ) : (
          <p className="muted">
            One handle, 1–31 characters. It becomes <code>&lt;handle&gt;.{root?.parentName}</code>, which
            anyone can resolve without this app.
          </p>
        )}
        {!loading && !handle && current && (
          <AttestFlow fixedDomain={current.domain} title="" onPublished={({ handle: h }) => setClaimed(h)} />
        )}
      </Step>

      {subjects.map((s, i) => {
        const isAnswered = answered(s.domain);
        const isCurrent = !!handle && current?.domain === s.domain;
        return (
          <Step
            key={s.domain}
            n={i + 2}
            title={`Answer ${s.domain}`}
            state={isAnswered ? "done" : isCurrent ? "now" : "todo"}
          >
            {isAnswered ? (
              <p className="muted">
                Answered. <Link href={`/claim?renew=${s.domain}`}>Change it →</Link>
              </p>
            ) : !handle ? (
              <p className="muted">Pick your name first.</p>
            ) : (
              <>
                <p className="muted">{questionFor(s.domain)}</p>
                {!loading && isCurrent && (
                  <AttestFlow
                    key={s.domain}
                    fixedDomain={s.domain}
                    fixedHandle={handle}
                    title=""
                    answerLabel="Your answer, permanent"
                    onPublished={({ domain }) => setDone((d) => new Set(d).add(domain))}
                  />
                )}
              </>
            )}
          </Step>
        );
      })}

      {!loading && finished && handle && root && (
        <>
          <section className="card" data-testid="share">
            <h2>Share it</h2>
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
                <Link href="/me#link">Link a work account</Link> — X, GitHub or Telegram, masked unless you
                share the view code. Verifiers count live links.
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
