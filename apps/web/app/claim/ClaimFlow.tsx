"use client";

import { useState } from "react";
import { AttestFlow } from "@/app/AttestFlow";
import { useWebConfig } from "@/app/providers";
import { shareSnippet } from "@/lib/profile";
import { CopyButton } from "@/app/CopyButton";

/**
 * Candidate journey: claim the root name, then one answer per subject instance, then share.
 * The publishing mechanics are AttestFlow; this component sequences the domains and keeps the
 * handle constant across them.
 */
export function ClaimFlow() {
  const config = useWebConfig();
  const [root, ...subjects] = config.instances;
  const [handle, setHandle] = useState<string>();
  const [done, setDone] = useState<Set<string>>(new Set());
  const step = !handle ? 0 : 1 + subjects.findIndex((s) => !done.has(s.domain));
  const current = !handle ? root : subjects.find((s) => !done.has(s.domain));
  const finished = !!handle && subjects.every((s) => done.has(s.domain));
  const siteUrl = typeof window === "undefined" ? "" : window.location.origin;

  return (
    <>
      <ol className="stepper" aria-label="Progress">
        <li className={handle ? "done" : "now"}>Claim {root?.parentName}</li>
        {subjects.map((s) => (
          <li
            key={s.domain}
            className={done.has(s.domain) ? "done" : current?.domain === s.domain ? "now" : ""}
          >
            Answer {s.domain}
          </li>
        ))}
        <li className={finished ? "now" : ""}>Share</li>
      </ol>

      {!finished && current && (
        <AttestFlow
          key={current.domain}
          fixedDomain={current.domain}
          fixedHandle={handle}
          title={step === 0 ? "Your handle" : `Question: ${current.domain}`}
          answerLabel={step === 0 ? undefined : questionFor(current.domain)}
          onPublished={({ handle: h, domain }) => {
            if (!handle) setHandle(h);
            if (domain !== root?.domain) setDone((d) => new Set(d).add(domain));
          }}
        />
      )}

      {finished && handle && root && (
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
          <p className="muted">
            Ask the people who can speak for you to open <code>/vouch/{handle}</code>. Every vouch is a
            verified human staking their own permanent name.
          </p>
        </section>
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
