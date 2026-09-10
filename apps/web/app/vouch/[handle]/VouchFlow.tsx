"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import type { Address } from "viem";
import { AttestFlow, type Published } from "@/app/AttestFlow";
import { InviteTerms } from "./InviteTerms";
import { LetterForm } from "./LetterForm";
import { useWebConfig } from "@/app/providers";
import { fmtUtc } from "@/app/ui";
import { apiFor, useContracts, useLetterWrite, useWalletDashboard } from "@/lib/hooks";
import type { SignedInvite } from "@ketsuban/registrar";
import type { Signer } from "@/lib/chain";
import { WITHDRAWN } from "@ketsuban/registrar";
import { VOUCH_PREFIX, voucherProgress, vouchSteps } from "@/lib/journey";
import { OpenToCandidate } from "./OpenToCandidate";
import { LETTER_MAX } from "@/lib/chain";
import { LetterField, letterBytes } from "./LetterField";
import type { Ask } from "@/lib/asks";

type Stage = "signin" | "onboarding" | "statement" | "done";

/**
 * Sequenced voucher steps, resumed from the wallet's on-chain records so a reload never repeats a
 * step. Humanity is proved once on the profile and shown here as pending. The statement
 * is a record in the candidate's own vouch domain, so no name of the voucher's own is required first;
 * a held root name is reused as the label, and claiming one is offered after publishing.
 */
export function VouchFlow({
  candidate,
  invite,
  withdraw,
  ask,
}: {
  candidate: string;
  invite?: SignedInvite;
  withdraw?: boolean;
  /** The reference the writer came to give, when they picked one from the popular asks */
  ask?: Ask;
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
    // A browser wallet can refuse this; the write path asks again and says which network to pick.
    await embedded.switchChain(config.chainId).catch(() => undefined);
    return {
      provider: await embedded.getEthereumProvider(),
      account: embedded.address as Address,
      chainId: config.chainId,
    };
  };
  const dash = useWalletDashboard(api, authenticated ? wallet : undefined);
  const contracts = useContracts(api);
  const onChain = voucherProgress(dash.data, root?.domain ?? "", candidate);

  const [published, setPublished] = useState<Published>();
  // The body of the reference, written in the same form as its title. It cannot be signed until the
  // record exists — the text record hangs on the name the record creates — so it is held here and
  // written the moment that name is there, rather than asked for again on a second screen.
  const [letter, setLetter] = useState("");
  const [letterState, setLetterState] = useState<"idle" | "writing" | "done" | "failed">("idle");
  const [letterError, setLetterError] = useState<string>();
  const letterWrite = useLetterWrite(candidate);
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

  /**
   * Write the letter onto the name the record just created. Kept by its hash when it is too long to
   * live on chain, and kept before the record points at it: a record naming a letter nobody holds is
   * worse than a record with no letter.
   */
  async function writeLetter(name: string, text: string) {
    const resolver = contracts.data?.permissionedResolver as Address | undefined;
    if (!resolver) {
      setLetterState("failed");
      setLetterError("this deployment has no permissioned resolver, so a letter cannot be written");
      return;
    }
    setLetterState("writing");
    setLetterError(undefined);
    try {
      const onChain = letterBytes(text) > LETTER_MAX ? (await api.storeLetter(text)).ref : text;
      await letterWrite.mutateAsync({ signer: await getSigner(), resolver, name, letter: onChain });
      setLetterState("done");
    } catch (e) {
      setLetterState("failed");
      setLetterError((e as Error).message);
    }
  }
  const loading = !ready || (authenticated && !!wallet && dash.isPending);

  return (
    <>
      <ol className="journey" aria-label="Progress">
        {vouchSteps(candidate, {
          authenticated,
          published: !!published,
          // Undefined where this deployment cannot ask for a proof: the step then stays pending
          // rather than becoming a task nobody can finish.
          human: contracts.data?.humanity ? !!dash.data?.humanity : undefined,
        }).map((step) => (
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

      {/* Signing in writes nothing, so the gate stands in the root name domain rather than a platform
          this deployment may not even hold. */}
      {!loading && stage === "signin" && (
        <AttestFlow fixedDomain={root?.domain ?? ""} title="Sign in to begin" hideForm />
      )}

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

      {!loading && stage === "statement" && root && onChain.org && !withdraw && (
        <p className="muted" data-testid="issuing-as">
          Issuing as <strong>{onChain.org.label}</strong>. An onboarded organisation writes without an
          invitation, because its own name is on the letter.
        </p>
      )}

      {!loading &&
        stage === "statement" &&
        root &&
        !withdraw &&
        !invite &&
        !onChain.existing &&
        !onChain.org && (
          <p className="muted" data-testid="unsolicited-notice">
            {candidate} did not ask for this one, so it will be marked <strong>unsolicited</strong>. That is a
            note on the reference, not a barrier: anyone may refer anyone, and what the reference is worth
            comes from who signs it. If they did invite you, open their link and this says so instead.
          </p>
        )}

      {!loading && stage === "statement" && root && !withdraw && (
        <>
          <p className="muted" data-testid="statement-intro">
            Lands as{" "}
            <code>
              {handle ?? "<you>"}.{candidate}.{root.parentName}
            </code>
            , signed by your wallet.
            {!handle &&
              " The name you pick is how this reference is signed; reuse it and your history adds up."}
          </p>
          {onChain.existing && (
            <p className="warning" data-testid="existing-statement">
              You already vouched for {candidate}: “{onChain.existing.statement}” (valid until{" "}
              {fmtUtc(onChain.existing.validUntil)}). Publishing again supersedes it — the old statement stays
              in the history as revoked.
            </p>
          )}
          {/* What the candidate asked of the writer, before they sign rather than after. */}
          <InviteTerms
            candidate={candidate}
            requires={invite?.requires ?? []}
            attested={(dash.data?.links ?? []).filter((l) => l.live).map((l) => l.domain)}
          />
          <AttestFlow
            fixedDomain={vouchDomain}
            fixedHandle={handle}
            invite={invite}
            title={onChain.existing ? "Update your reference" : "Write your reference"}
            answerLabel="Title"
            answerHint="Written into the name itself, on chain, and permanent. 31 bytes is all a name holds."
            answerPlaceholder="CTO at Acme 2019-22"
            extra={<LetterField value={letter} onChange={setLetter} candidate={candidate} />}
            onPublished={(p) => {
              setPublished(p);
              // One decision, one form: the letter was written here, so it is not asked for again.
              if (p.name && letter.trim()) void writeLetter(p.name, letter.trim());
            }}
          />
        </>
      )}

      {/* A masked writer hands over a reference nobody can attribute. The view code is in this browser
          now, and they may never come back, so the offer is made here rather than filed for later. */}
      {stage === "done" && published && handle && root && (
        <OpenToCandidate
          api={api}
          candidate={candidate}
          rootParent={root.parentName}
          voucherName={`${handle}.${root.parentName}`}
          links={dash.data?.links ?? []}
        />
      )}

      {/* The letter was written in the same form as the title, so what happened to it is said here
          rather than left to a second form the person did not ask for. */}
      {stage === "done" && letterState !== "idle" && (
        <p
          className={letterState === "failed" ? "error" : "muted"}
          role={letterState === "failed" ? "alert" : undefined}
          data-testid="letter-status"
        >
          {letterState === "writing"
            ? "writing your letter…"
            : letterState === "done"
              ? "Letter written."
              : `Your reference is published, but the letter was not written: ${letterError}`}
        </p>
      )}

      {stage === "done" && published?.name && letterState !== "done" && (
        <LetterForm api={api} candidate={candidate} name={published.name} getSigner={getSigner} />
      )}

      {stage === "done" && published && (
        <section className="card" data-testid="vouch-done">
          <h2>Reference published</h2>
          <p>
            <code>{published.name}</code> resolves to your statement, and carries your standing with it.
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
            <Link href="/me">{handle ? "Collect references of your own →" : "Claim your name →"}</Link> ·{" "}
            <Link href={`/p/${candidate}`}>See {candidate}&apos;s page →</Link> ·{" "}
            <Link href="/me">Your dashboard →</Link>
          </p>
        </section>
      )}
    </>
  );
}
