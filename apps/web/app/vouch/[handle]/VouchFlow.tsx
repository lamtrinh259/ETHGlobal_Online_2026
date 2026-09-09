"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import type { Address } from "viem";
import { AttestFlow, type Published } from "@/app/AttestFlow";
import { useWebConfig } from "@/app/providers";
import { fmtUtc } from "@/app/ui";
import { apiFor, useWalletDashboard } from "@/lib/hooks";
import { VOUCH_PREFIX, voucherProgress, vouchSteps } from "@/lib/journey";

type Stage = "signin" | "work" | "statement" | "done";

/**
 * Sequenced voucher steps, resumed from the wallet's on-chain records so a reload never repeats a
 * step. Humanity (World Selfie Check) is gated on partner access and shown as pending. The statement
 * is a record in the candidate's own vouch domain, so no name of the voucher's own is required first;
 * a held root name is reused as the label, and claiming one is offered after publishing.
 */
export function VouchFlow({ candidate }: { candidate: string }) {
  const config = useWebConfig();
  const root = config.instances[0];
  const api = useMemo(() => apiFor(config), [config]);
  const { ready, authenticated } = usePrivy();
  const { wallets } = useWallets();
  const wallet = (wallets.find((w) => w.walletClientType === "privy") ?? wallets[0])?.address as
    Address | undefined;
  const dash = useWalletDashboard(api, authenticated ? wallet : undefined);
  const onChain = voucherProgress(dash.data, root?.domain ?? "", candidate);

  const [linked, setLinked] = useState(false);
  const [published, setPublished] = useState<Published>();
  const isLinked = linked || onChain.linked;
  const handle = onChain.named;
  const stage: Stage = !authenticated ? "signin" : published ? "done" : !isLinked ? "work" : "statement";
  const vouchDomain = `${VOUCH_PREFIX}${candidate}`;
  const loading = !ready || (authenticated && !!wallet && dash.isPending);

  return (
    <>
      <p className="muted">Five minutes. Four signatures, no fees. Here is the whole thing:</p>
      <ol className="journey" aria-label="Progress">
        {vouchSteps(candidate, { authenticated, linked: isLinked, published: !!published }).map((step) => (
          <li key={step.id} className={step.state}>
            <span>
              <span className="j-label">
                {step.label}
                {step.state === "pending" && <small className="muted"> · coming soon</small>}
                {step.id === "write" && onChain.existing && <small className="muted"> · update</small>}
              </span>
              <span className="j-why">{step.detail}</span>
            </span>
          </li>
        ))}
      </ol>

      {loading && <p className="muted">loading…</p>}

      {!loading && stage === "signin" && <AttestFlow fixedDomain="x" title="Sign in to begin" hideForm />}

      {!loading && stage === "work" && (
        <>
          <p className="muted">
            Link the account you worked from (X, GitHub, Telegram…). The enclave attests control of it; keep
            it masked if you prefer — only holders of your view code can read which account.
          </p>
          <AttestFlow fixedDomain="x" title="Work account" onPublished={() => setLinked(true)} />
        </>
      )}

      {!loading && stage === "statement" && root && (
        <>
          <p className="muted" data-testid="statement-intro">
            Relationship, organisation, overlap period — in 31 bytes. It lands as{" "}
            <code>
              {handle ?? "<you>"}.{candidate}.{root.parentName}
            </code>
            , signed by your wallet, permanent.
            {!handle &&
              " The name you pick here is how this reference is signed; reuse it and your history adds up."}
          </p>
          {onChain.existing && (
            <p className="warning" data-testid="existing-statement">
              You already vouched for {candidate}: “{onChain.existing.statement}” (valid until{" "}
              {fmtUtc(onChain.existing.validUntil)}). Publishing again supersedes it — the old statement stays
              in the history as revoked.
            </p>
          )}
          <AttestFlow
            fixedDomain={vouchDomain}
            fixedHandle={handle}
            title={onChain.existing ? "Update your reference" : "Write your reference"}
            answerLabel="Your statement (≤31 bytes, permanent)"
            onPublished={setPublished}
          />
        </>
      )}

      {stage === "done" && published && (
        <section className="card" data-testid="vouch-done">
          <h2>Reference published</h2>
          <p>
            <code>{published.name}</code> now resolves to your statement. It carries your standing: anyone
            checking {candidate} sees who you are and what else you have vouched for.
          </p>
          {handle ? (
            <p>
              It is signed by{" "}
              <code>
                {handle}.{root?.parentName}
              </code>
              , so it adds to your own standing.
            </p>
          ) : (
            <p data-testid="claim-cta">
              You signed as <code>{published.handle}</code> in {candidate}&apos;s domain. Claim{" "}
              <code>
                {published.handle}.{root?.parentName}
              </code>{" "}
              to make that name yours everywhere: your references then collect under one name and work as your
              own credential. The hard part, proving who you are, is already done.
            </p>
          )}
          <p>
            <Link href="/claim">{handle ? "Collect references of your own →" : "Claim your name →"}</Link> ·{" "}
            <Link href={`/p/${candidate}`}>See {candidate}&apos;s page →</Link> ·{" "}
            <Link href="/me">Your dashboard →</Link>
          </p>
        </section>
      )}
    </>
  );
}
