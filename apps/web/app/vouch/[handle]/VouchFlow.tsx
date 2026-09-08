"use client";

import Link from "next/link";
import { useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { AttestFlow } from "@/app/AttestFlow";
import { useWebConfig } from "@/app/providers";

type Stage = "signin" | "humanity" | "work" | "statement" | "name";

/**
 * Sequenced voucher steps. Humanity (World Selfie Check) is gated on partner access and shown as
 * pending; the work-context link reuses the platform-record flow; the statement lands as the
 * voucher's own name once per-candidate vouch instances are live.
 */
export function VouchFlow({ candidate }: { candidate: string }) {
  const config = useWebConfig();
  const root = config.instances[0];
  const { ready, authenticated } = usePrivy();
  const [linked, setLinked] = useState(false);
  const [named, setNamed] = useState<string>();
  const [published, setPublished] = useState<string>();
  const stage: Stage = !authenticated ? "signin" : !linked ? "work" : !named ? "name" : "statement";
  const vouchDomain = `~${candidate}`;

  return (
    <>
      <ol className="stepper" aria-label="Progress">
        <li className={authenticated ? "done" : "now"}>Sign in</li>
        <li className="pending" title="World Selfie Check — partner access pending">
          Prove unique humanity <small>(pending)</small>
        </li>
        <li className={linked ? "done" : stage === "work" ? "now" : ""}>Corroborate work context</li>
        <li className={named ? "done" : stage === "name" ? "now" : ""}>Your permanent name</li>
        <li className={stage === "statement" ? "now" : ""}>Write and sign</li>
      </ol>

      {!ready && <p className="muted">loading…</p>}

      {ready && stage === "signin" && <AttestFlow fixedDomain="x" title="Sign in to begin" hideForm />}

      {ready && stage === "work" && (
        <>
          <p className="muted">
            Link the account you worked from (X, GitHub, Telegram…). The enclave attests control of it; keep
            it masked if you prefer — only holders of your view code can read which account.
          </p>
          <AttestFlow fixedDomain="x" title="Work account" onPublished={() => setLinked(true)} />
        </>
      )}

      {ready && stage === "name" && root && (
        <>
          <p className="muted">
            Your vouching history lives under a name that follows you across employers:{" "}
            <code>&lt;you&gt;.{root.parentName}</code>.
          </p>
          <AttestFlow
            fixedDomain={root.domain}
            title="Your handle"
            onPublished={({ handle }) => setNamed(handle)}
          />
        </>
      )}

      {ready && stage === "statement" && named && (
        <section className="card" data-testid="statement-pending">
          <h2>Write your reference</h2>
          <p>
            Relationship, organisation, overlap period, two sentences. Signed by{" "}
            <code>
              {named}.{root?.parentName}
            </code>{" "}
            about{" "}
            <code>
              {candidate}.{root?.parentName}
            </code>
            .
          </p>
          <p className="warning">
            Vouch statements land as{" "}
            <code>
              {named}.{candidate}.{root?.parentName}
            </code>{" "}
            — the per-candidate vouch instance is provisioned by the relay and ships in the next iteration.
            Your name and work link above are already permanent.
          </p>
          <p>
            <Link href={`/p/${candidate}`}>See {candidate}&apos;s page →</Link> ·{" "}
            <Link href="/claim">Want references of your own? Claim your page →</Link>
          </p>
        </section>
      )}
    </>
  );
}
