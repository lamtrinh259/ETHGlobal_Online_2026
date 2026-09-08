"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import type { Address } from "viem";
import { AttestFlow, type Published } from "@/app/AttestFlow";
import { useWebConfig } from "@/app/providers";
import { fmtUtc } from "@/app/ui";
import { apiFor, useWalletDashboard } from "@/lib/hooks";
import { VOUCH_PREFIX, voucherProgress } from "@/lib/journey";

type Stage = "signin" | "work" | "name" | "statement" | "done";

/**
 * Sequenced voucher steps, resumed from the wallet's on-chain records so a reload never repeats a
 * step. Humanity (World Selfie Check) is gated on partner access and shown as pending. The statement
 * lands as `<voucher>.<candidate>.<root>` in the candidate's vouch instance.
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
  const [named, setNamed] = useState<string>();
  const [published, setPublished] = useState<Published>();
  const isLinked = linked || onChain.linked;
  const handle = named ?? onChain.named;
  const stage: Stage = !authenticated
    ? "signin"
    : published
      ? "done"
      : !isLinked
        ? "work"
        : !handle
          ? "name"
          : "statement";
  const vouchDomain = `${VOUCH_PREFIX}${candidate}`;
  const loading = !ready || (authenticated && !!wallet && dash.isPending);

  return (
    <>
      <ol className="stepper" aria-label="Progress">
        <li className={authenticated ? "done" : "now"}>Sign in</li>
        <li className="pending" title="World Selfie Check — partner access pending">
          Prove unique humanity <small>(pending)</small>
        </li>
        <li className={isLinked ? "done" : stage === "work" ? "now" : ""}>Corroborate work context</li>
        <li className={handle ? "done" : stage === "name" ? "now" : ""}>Your permanent name</li>
        <li className={stage === "done" ? "done" : stage === "statement" ? "now" : ""}>
          {onChain.existing ? "Update your reference" : "Write and sign"}
        </li>
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

      {!loading && stage === "name" && root && (
        <>
          <p className="muted">
            Your vouching history lives under a name that follows you across employers:{" "}
            <code>&lt;you&gt;.{root.parentName}</code>.
          </p>
          <AttestFlow
            fixedDomain={root.domain}
            title="Your handle"
            onPublished={({ handle: h }) => setNamed(h)}
          />
        </>
      )}

      {!loading && stage === "statement" && handle && root && (
        <>
          <p className="muted" data-testid="statement-intro">
            Relationship, organisation, overlap period — in 31 bytes. Signed by{" "}
            <code>
              {handle}.{root.parentName}
            </code>
            , lands as{" "}
            <code>
              {handle}.{candidate}.{root.parentName}
            </code>
            , permanent.
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
          <p>
            <Link href={`/p/${candidate}`}>See {candidate}&apos;s page →</Link> ·{" "}
            <Link href="/me">Your dashboard →</Link> ·{" "}
            <Link href="/claim">Want references of your own? Claim your page →</Link>
          </p>
        </section>
      )}
    </>
  );
}
