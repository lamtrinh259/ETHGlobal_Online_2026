"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import type { Address } from "viem";
import { AttestFlow, type Published } from "@/app/AttestFlow";
import { LetterForm } from "./LetterForm";
import { useWebConfig } from "@/app/providers";
import { fmtUtc } from "@/app/ui";
import { apiFor, useWalletDashboard } from "@/lib/hooks";
import type { SignedInvite } from "@ketsuban/registrar";
import type { Signer } from "@/lib/chain";
import { WITHDRAWN } from "@ketsuban/registrar";
import { VOUCH_PREFIX, voucherProgress, vouchSteps } from "@/lib/journey";

type Stage = "signin" | "onboarding" | "statement" | "done";

/**
 * Sequenced voucher steps, resumed from the wallet's on-chain records so a reload never repeats a
 * step. Humanity (World Selfie Check) is gated on partner access and shown as pending. The statement
 * is a record in the candidate's own vouch domain, so no name of the voucher's own is required first;
 * a held root name is reused as the label, and claiming one is offered after publishing.
 */
export function VouchFlow({
  candidate,
  invite,
  withdraw,
}: {
  candidate: string;
  invite?: SignedInvite;
  withdraw?: boolean;
}) {
  const config = useWebConfig();
  const root = config.instances[0];
  const api = useMemo(() => apiFor(config), [config]);
  const { ready, authenticated } = usePrivy();
  const { wallets } = useWallets();
  const embedded = wallets.find((w) => w.walletClientType === "privy") ?? wallets[0];
  const wallet = embedded?.address as Address | undefined;
  const getSigner = async (): Promise<Signer> => {
    if (!embedded) throw new Error("no wallet");
    await embedded.switchChain(config.chainId);
    return {
      provider: await embedded.getEthereumProvider(),
      account: embedded.address as Address,
      chainId: config.chainId,
    };
  };
  const dash = useWalletDashboard(api, authenticated ? wallet : undefined);
  const onChain = voucherProgress(dash.data, root?.domain ?? "", candidate);

  const [published, setPublished] = useState<Published>();
  const isLinked = onChain.linked;
  const handle = onChain.named;
  const stage: Stage = !authenticated
    ? "signin"
    : published
      ? "done"
      : !isLinked
        ? "onboarding"
        : "statement";
  const vouchDomain = `${VOUCH_PREFIX}${candidate}`;
  const loading = !ready || (authenticated && !!wallet && dash.isPending);

  return (
    <>
      <p className="muted">Five minutes. Four signatures, no fees. Here is the whole thing:</p>
      <ol className="journey" aria-label="Progress">
        {vouchSteps(candidate, { authenticated, published: !!published }).map((step) => (
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

      {!loading && stage === "onboarding" && (
        <section className="card" data-testid="onboarding-gate">
          <h2>Finish your onboarding first</h2>
          <p>
            A reference carries weight because the person writing it has shown how they know the candidate.
            That is a one-time step on your profile, not something you repeat for every person you vouch for.
          </p>
          <p className="muted">
            Connect the account you worked from and attest it once. Come back here afterwards and this page
            picks up where you left off.
          </p>
          <p>
            <Link href="/me#link" className="primary">
              Complete your onboarding →
            </Link>
          </p>
        </section>
      )}

      {!loading && stage === "statement" && root && onChain.existing && withdraw && (
        <>
          <p className="warning" data-testid="withdrawing">
            Withdrawing your reference for {candidate}. The record stays — “{onChain.existing.statement}”
            remains in the history, marked superseded — and the live statement becomes{" "}
            <code>{WITHDRAWN}</code>. That is what withdrawal means here: nothing disappears.
          </p>
          <AttestFlow
            fixedDomain={vouchDomain}
            fixedHandle={handle}
            title={`Withdraw your reference for ${candidate}`}
            answerLabel="Statement"
            answerPlaceholder={WITHDRAWN}
            answerValue={WITHDRAWN}
            onPublished={setPublished}
          />
        </>
      )}

      {!loading && stage === "statement" && root && !withdraw && !invite && !onChain.existing && (
        <section className="card" data-testid="no-invite">
          <h2>You need {candidate}&apos;s invitation</h2>
          <p>
            A vouch domain belongs to its candidate: only someone they invited can write a statement there.
            Ask {candidate} for their invite link and open it — the rest of this page is unchanged.
          </p>
          <p className="muted">
            They make one from their dashboard in two clicks. It costs them nothing and needs no gas.
          </p>
        </section>
      )}

      {!loading && stage === "statement" && root && !withdraw && (invite || onChain.existing) && (
        <>
          <p className="muted" data-testid="statement-intro">
            A few words is what the name itself carries; the full letter comes next, as a text record. It
            lands as{" "}
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
            invite={invite}
            title={onChain.existing ? "Update your reference" : "Write your reference"}
            answerLabel="A few words about them, permanent"
            answerPlaceholder="CTO at Acme 2019-22"
            onPublished={setPublished}
          />
        </>
      )}

      {stage === "done" && published?.name && (
        <LetterForm api={api} candidate={candidate} name={published.name} getSigner={getSigner} />
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
