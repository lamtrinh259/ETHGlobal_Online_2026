"use client";

import Link from "next/link";
import { accountMismatch, describeRequirement, whyUnsatisfiable } from "@/lib/invite";
import { connectedAccounts, type LinkedAccounts } from "@/lib/identity";
import { parseRequirement, platformOf } from "@ketsuban/registrar";
import { useMemo, useState, type ReactNode } from "react";
import { useLinkAccount, usePrivy, useWallets } from "@privy-io/react-auth";
import type { Address } from "viem";
import { AttestFlow, type Published } from "@/app/AttestFlow";
import { TxDone } from "@/app/TxDone";
import { InviteTerms } from "./InviteTerms";
import { LetterForm } from "./LetterForm";
import { useWebConfig } from "@/app/providers";
import { fmtUtc } from "@/app/ui";
import {
  apiFor,
  useContracts,
  useDisclosures,
  useLetterWrite,
  useViewCodeSync,
  useWalletDashboard,
} from "@/lib/hooks";
import type { SignedInvite } from "@ketsuban/registrar";
import type { Signer } from "@/lib/chain";
import { WITHDRAWN } from "@ketsuban/registrar";
import { VOUCH_PREFIX, voucherProgress } from "@/lib/journey";
import { OpenToCandidate } from "./OpenToCandidate";
import { Revealed } from "@/app/Revealed";
import { HumanityCheck } from "@/app/me/HumanityCheck";
import { linkKeyFromInvite } from "@/lib/disclose";
import { ZERO_ADDRESS } from "@ketsuban/registrar";
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
  inviteCode,
  withdraw,
  ask,
  candidateCard,
}: {
  candidate: string;
  /** Who is being referred, rendered by the page that already fetched them */
  candidateCard?: ReactNode;
  invite?: SignedInvite;
  /** The invitation's own code, which is the secret opening anything the candidate shared with it */
  inviteCode?: string;
  withdraw?: boolean;
  /** The reference the writer came to give, when they picked one from the popular asks */
  ask?: Ask;
}) {
  const config = useWebConfig();
  const root = config.instances[0];
  const api = useMemo(() => apiFor(config), [config]);
  const { ready, authenticated, user } = usePrivy();
  // The row that says an account is missing carries the button that links it: nobody should have to
  // find the same platform again in the form below.
  const [linkError, setLinkError] = useState<string>();
  const linker = useLinkAccount({
    onSuccess: () => setLinkError(undefined),
    onError: (error) => setLinkError(`Linking failed: ${String(error)}.`),
  });
  const linkFor: Record<string, { label: string; link: () => void }> = {
    x: { label: "X", link: () => linker.linkTwitter() },
    github: { label: "GitHub", link: () => linker.linkGithub() },
    discord: { label: "Discord", link: () => linker.linkDiscord() },
    google: { label: "Google", link: () => linker.linkGoogle() },
    email: { label: "an email address", link: () => linker.linkEmail() },
  };
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
  // After an account is attested here, the dashboard is polled until the index lists it.
  const [awaitingLink, setAwaitingLink] = useState(false);
  /*
   * The account whose form is open. Remembered rather than derived, so the confirmation — the view
   * code above all — stays on screen after the record lands instead of vanishing the moment the
   * dashboard lists the link and the next step takes its place.
   */
  const [attesting, setAttesting] = useState<string>();
  /** Whether the name was claimed on this page, so its step stays open with the confirmation inside. */
  const [claimedHere, setClaimedHere] = useState(false);
  /*
   * What was done on this page, before the index lists it. A step is the person's to tick at the
   * publish; the index trails the chain by a poll, and a step still open after the confirmation reads
   * as a failure and sends them looking for a Next button.
   */
  const [claimedName, setClaimedName] = useState<string>();
  const [attestedHere, setAttestedHere] = useState<string[]>([]);
  const [humanHere, setHumanHere] = useState(false);
  /** The step the writer is looking at; unset, it is the first one not done. */
  const [chosen, setChosen] = useState<string>();
  const dash = useWalletDashboard(api, authenticated ? wallet : undefined, awaitingLink);
  useViewCodeSync(api);
  const contracts = useContracts(api);
  const onChain = voucherProgress(dash.data, root?.domain ?? "", candidate);

  const [published, setPublished] = useState<Published>();
  // The body of the reference, written in the same form as its title. It cannot be signed until the
  // record exists — the text record hangs on the name the record creates — so it is held here and
  // written the moment that name is there, rather than asked for again on a second screen.
  const [letter, setLetter] = useState("");
  const [letterState, setLetterState] = useState<"idle" | "writing" | "done" | "failed">("idle");
  const [letterError, setLetterError] = useState<string>();
  /** The transaction the wallet's own letter write landed in, until its confirmation is read */
  const [letterTx, setLetterTx] = useState<string>();
  const letterWrite = useLetterWrite(candidate);
  const handle = onChain.named ?? claimedName;
  // One real person writes a reference, or nobody does: where the deployment can check humanity, a
  // writer without a live proof is sent to pass it before a statement is asked of them.
  const needsHuman =
    !!contracts.data?.humanity && dash.data !== undefined && !dash.data.humanity && !humanHere;
  // A reference is signed by the writer's own name, so the name is the first thing, not a field on the
  // statement form.
  const needsName = dash.data !== undefined && !handle;
  // The accounts the invitation asks for that somebody could hold, and which are not attested yet;
  // a masked account counts, so this is answered without publishing which account it is.
  const attestedNow = [
    ...(dash.data?.links ?? []).filter((l) => l.live).map((l) => l.domain.toLowerCase()),
    ...attestedHere,
  ];
  const askedFor = (invite?.requires ?? []).filter((d) => !whyUnsatisfiable(d, config.parentNames));
  const stillToLink = askedFor.filter((d) => !attestedNow.includes(parseRequirement(d).domain));
  // A requirement naming one account that this sign-in is not: nothing to link can change it.
  const notYou = askedFor
    .map((d) => accountMismatch(d, connectedAccounts(user as LinkedAccounts | null | undefined)))
    .filter((m): m is NonNullable<typeof m> => !!m);
  const stage: Stage = !authenticated
    ? "signin"
    : published
      ? "done"
      : needsName || stillToLink.length > 0 || notYou.length > 0 || needsHuman
        ? "onboarding"
        : "statement";
  const vouchDomain = `${VOUCH_PREFIX}${candidate}`;
  /*
   * The accounts this candidate has opened to whoever holds a link. The list itself is public — it
   * names domains and expiry, never a handle — and opening one still takes the invitation's own code.
   */
  const candidateName = root ? `${candidate}.${root.parentName}` : "";
  const shares = useDisclosures(api, inviteCode && candidateName ? candidateName : undefined);
  const shared = [
    ...new Set(
      (shares.data?.grants ?? [])
        .filter((g) => !g.audienceName && g.audience.toLowerCase() === ZERO_ADDRESS)
        .flatMap((g) => g.domains)
    ),
  ];

  // Said in the preview too: somebody deciding whether to start should not be told to go and link
  // something nobody can hold, and the detailed view only corrects that once they have signed in.
  const impossibleAsk = (invite?.requires ?? [])
    .map((d) => whyUnsatisfiable(d, config.parentNames))
    .find(Boolean);
  const humanityDone = !!dash.data?.humanity || humanHere;

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
      // The reference went through the relay for free; the letter is the wallet's own transaction. An
      // empty wallet is topped up by the relay first, and the write waits for the gas to land.
      if (wallet && dash.data?.gasTopup?.available) {
        await api.gas(wallet);
        for (let i = 0; i < 20; i++) {
          if (BigInt((await api.wallet(wallet)).balance) > 0n) break;
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
      const onChain = letterBytes(text) > LETTER_MAX ? (await api.storeLetter(text)).ref : text;
      setLetterTx(
        await letterWrite.mutateAsync({ signer: await getSigner(), resolver, name, letter: onChain })
      );
      setLetterState("done");
    } catch (e) {
      setLetterState("failed");
      setLetterError((e as Error).message);
    }
  }
  const loading = !ready || (authenticated && !!wallet && dash.isPending);

  /*
   * One card, one step at a time. Every panel stays mounted behind the current one, so a confirmation
   * — the view code above all — is still there when the writer comes back to it; a done step is only
   * a tick on the rail, not something the page takes away.
   */
  type StepId = "signin" | "name" | "accounts" | "human" | "reference";
  const steps: { id: StepId; label: string; done: boolean }[] = [
    { id: "signin", label: "Sign in", done: authenticated },
    { id: "name", label: "Your name", done: !!handle },
    ...(askedFor.length > 0
      ? [
          {
            id: "accounts" as const,
            label: `Accounts ${candidate} asked for`,
            done: stillToLink.length === 0 && notYou.length === 0,
          },
        ]
      : []),
    ...(contracts.data?.humanity
      ? [{ id: "human" as const, label: "Selfie Check", done: humanityDone }]
      : []),
    { id: "reference", label: `Vouch for ${candidate}`, done: !!published },
  ];
  const firstOpen = steps.findIndex((s) => !s.done);
  const defaultIndex = firstOpen === -1 ? steps.length - 1 : firstOpen;
  const chosenIndex = chosen ? steps.findIndex((s) => s.id === chosen) : -1;
  const current = chosenIndex === -1 ? defaultIndex : chosenIndex;
  const at = steps[current]!;
  const allDone = steps.slice(0, -1).every((s) => s.done);
  const panel = (id: StepId) => ({ hidden: at.id !== id, className: "step-panel" });

  return (
    <section className="card stepper" data-testid="vouch-stepper">
      <ol className="stepper-nav" aria-label="Steps">
        {steps.map((s, i) => (
          <li key={s.id} className={i === current ? "current" : s.done ? "done" : undefined}>
            <button
              type="button"
              onClick={() => setChosen(s.id)}
              aria-current={i === current ? "step" : undefined}
              data-testid={`step-${s.id}`}
            >
              <span className="step-mark" aria-hidden>
                {s.done ? "✓" : i + 1}
              </span>
              <span className="step-label">{s.label}</span>
            </button>
          </li>
        ))}
      </ol>

      <div {...panel("signin")}>
        {(invite?.requires.length ?? 0) > 0 && stage === "signin" && (
          <p className={impossibleAsk ? "warning" : "muted"} data-testid="invite-preview">
            {candidate} asks for <strong>{invite?.requires.map(describeRequirement).join(" and ")}</strong>.{" "}
            {impossibleAsk
              ? `${impossibleAsk} Write it if you mean to — it is published either way — but it cannot count as one ${candidate} asked for.`
              : "A masked account counts."}
          </p>
        )}
        {loading && <p className="muted">loading…</p>}
        {/* Signing in writes nothing, so the gate stands in the root name domain. */}
        {!loading && stage === "signin" && <AttestFlow fixedDomain={root?.domain ?? ""} title="" hideForm />}
        {authenticated && <p className="muted">Signed in.</p>}
      </div>

      {!loading &&
      authenticated &&
      !published &&
      root &&
      (needsName || claimedHere || askedFor.length > 0 || contracts.data?.humanity) ? (
        <div data-testid="onboarding-gate">
          <div {...panel("name")}>
            <p className="muted">
              {onChain.named ? (
                <>
                  <code>
                    {onChain.named}.{root.parentName}
                  </code>{" "}
                  signs every vouch you write.
                </>
              ) : (
                "Signs every vouch you write. Yours for good."
              )}
            </p>
            {(needsName || claimedHere) && (
              <AttestFlow
                key="name"
                fixedDomain={root.domain}
                title=""
                doneTitle="Name claimed"
                onPublished={(p) => {
                  // Stay here: the confirmation is read before the next step, never swapped away.
                  setChosen("name");
                  setClaimedHere(true);
                  setClaimedName(p.handle);
                  setAwaitingLink(true);
                  void dash.refetch();
                }}
                onDoneRead={() => setChosen(undefined)}
              />
            )}
          </div>
          {askedFor.length > 0 && (
            <div {...panel("accounts")}>
              <p className="muted">Sign in there, then Sign &amp; publish. Stays masked.</p>
              <ul className="journey" data-testid="onboarding-steps">
                {askedFor.map((d) => {
                  const { domain } = parseRequirement(d);
                  const platform = platformOf(domain) ?? "";
                  const linked = connectedAccounts(user as LinkedAccounts | null | undefined).some((a) =>
                    platform === "email"
                      ? (a.domain === "email" || a.domain === "google") &&
                        a.label.toLowerCase().endsWith(`@${domain}`)
                      : a.domain === platform
                  );
                  const mismatch = notYou.find((m) => m.domain === domain);
                  const todo = stillToLink.includes(d) || !!mismatch;
                  return (
                    <li key={d} className={todo ? "todo" : "done"}>
                      {describeRequirement(d)}
                      {mismatch
                        ? ` — ❌ ${mismatch.held.length ? `linked as ${mismatch.held.map((h) => `@${h}`).join(", ")}` : "no account linked"}, not @${mismatch.wanted}`
                        : !todo
                          ? " — attested"
                          : linked
                            ? " — linked; sign and publish below"
                            : " — not attested yet"}
                      {todo && !linked && !mismatch && linkFor[platform] && (
                        <>
                          {" "}
                          <button
                            className="primary"
                            onClick={linkFor[platform].link}
                            data-testid={`link-${d}`}
                          >
                            Link {linkFor[platform].label}
                          </button>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
              {linkError && (
                <p className="warning" data-testid="gate-link-error">
                  {linkError}
                </p>
              )}
              {notYou.length > 0 && (
                <div className="error" role="alert" data-testid="not-you">
                  <p>
                    <strong>Account mismatch.</strong> {candidate} asked for{" "}
                    {notYou.map((m) => `@${m.wanted} on ${m.domain}`).join(" and ")}; you are signed in with{" "}
                    {notYou
                      .map((m) =>
                        m.held.length ? m.held.map((h) => `@${h}`).join(", ") : `no ${m.domain} account`
                      )
                      .join(" and ")}
                    .
                  </p>
                  <p>
                    Log out and sign in with {notYou.map((m) => `@${m.wanted}`).join(" and ")}, or ask{" "}
                    {candidate} for an invitation naming your account. A vouch written as you are now is
                    published, but reads as not asked for.
                  </p>
                </div>
              )}
              {(attesting ?? stillToLink[0]) && (
                <AttestFlow
                  key={attesting ?? stillToLink[0]}
                  fixedDomain={parseRequirement(attesting ?? stillToLink[0]!).domain}
                  allowLinking
                  title=""
                  doneTitle="Account attested"
                  onPublished={() => {
                    const done = attesting ?? stillToLink[0]!;
                    setChosen("accounts");
                    setAttesting(done);
                    setAttestedHere((prev) => [...prev, parseRequirement(done).domain]);
                    setAwaitingLink(true);
                    void dash.refetch();
                  }}
                  onDoneRead={() => {
                    setAttesting(undefined);
                    setChosen(undefined);
                  }}
                />
              )}
              {attesting && stillToLink.some((d) => d !== attesting) && (
                <p>
                  <button
                    className="primary"
                    onClick={() => setAttesting(stillToLink.find((d) => d !== attesting))}
                    data-testid="next-account"
                  >
                    Next: {describeRequirement(stillToLink.find((d) => d !== attesting)!)} →
                  </button>
                </p>
              )}
            </div>
          )}
          {contracts.data?.humanity && (
            <div {...panel("human")} data-testid="humanity-gate">
              <p className="muted">Once per wallet. Proves one human, not who.</p>
              {needsHuman ? (
                <HumanityCheck
                  api={api}
                  wallet={wallet}
                  onVerified={() => {
                    setHumanHere(true);
                    setChosen(undefined);
                    void dash.refetch();
                  }}
                />
              ) : (
                <p className="muted">Passed.</p>
              )}
            </div>
          )}
        </div>
      ) : (
        <>
          <div {...panel("name")}>
            <p className="muted">{authenticated ? "Done." : "Sign in first."}</p>
          </div>
          {askedFor.length > 0 && (
            <div {...panel("accounts")}>
              <p className="muted">{authenticated ? "Done." : "Sign in first."}</p>
            </div>
          )}
          {contracts.data?.humanity && (
            <div {...panel("human")} data-testid="humanity-gate">
              <p className="muted">{authenticated ? "Done." : "Sign in first."}</p>
            </div>
          )}
        </>
      )}

      <div {...panel("reference")} data-testid="reference-box">
        {candidateCard}
        {/* What the candidate opened for whoever holds this invitation: the invitation is the permission. */}
        {inviteCode &&
          root &&
          shared.map((domain) => (
            <Revealed
              key={domain}
              name={`${candidate}.${root.parentName}`}
              domain={domain}
              linkKey={linkKeyFromInvite(inviteCode)}
            />
          ))}
        {authenticated && (invite?.requires.length ?? 0) > 0 && (
          <InviteTerms
            candidate={candidate}
            parentNames={config.parentNames}
            requires={invite?.requires ?? []}
            attested={(dash.data?.links ?? []).filter((l) => l.live).map((l) => l.domain)}
          />
        )}
        {!loading && !allDone && !published && (
          <p className="muted" data-testid="reference-waits">
            Finish the steps first.{" "}
            <button
              type="button"
              onClick={() => setChosen(steps[defaultIndex]!.id)}
              data-testid="go-first-open"
            >
              {steps[defaultIndex]!.label} →
            </button>
          </p>
        )}
        {!loading && authenticated && (stage === "statement" || stage === "done") && (
          <p className="muted" data-testid="profile-cta">
            <Link href="/me">Add a photo and a line about you →</Link>
          </p>
        )}

        {!loading && stage === "statement" && root && onChain.existing && withdraw && (
          <>
            <p className="warning" data-testid="withdrawing">
              Withdrawing. “{onChain.existing.statement}” stays in the history; the live statement becomes{" "}
              <code>{WITHDRAWN}</code>.
            </p>
            <AttestFlow
              fixedDomain={vouchDomain}
              fixedHandle={handle}
              title=""
              answerLabel="Statement"
              answerPlaceholder={WITHDRAWN}
              answerValue={WITHDRAWN}
              doneTitle="Vouch withdrawn"
              onPublished={setPublished}
            />
          </>
        )}

        {!loading && stage === "statement" && root && onChain.org && !withdraw && (
          <p className="muted" data-testid="issuing-as">
            Issuing as <strong>{onChain.org.label}</strong>.
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
              {candidate} did not ask for this one: it will be marked <strong>unsolicited</strong>. Anyone may
              refer anyone.
            </p>
          )}

        {!loading && stage === "statement" && root && !withdraw && (
          <>
            <p className="muted" data-testid="statement-intro">
              Signed as{" "}
              <code>
                {handle}.{candidate}.{root.parentName}
              </code>
              . Permanent; withdrawable, never deleted.
            </p>
            {onChain.existing && (
              <p className="warning" data-testid="existing-statement">
                Already vouched: “{onChain.existing.statement}” (until {fmtUtc(onChain.existing.validUntil)}).
                Publishing again supersedes it.
              </p>
            )}
            <AttestFlow
              fixedDomain={vouchDomain}
              fixedHandle={handle}
              invite={invite}
              title=""
              answerLabel="Title"
              answerHint="On chain, permanent. 31 bytes."
              answerPlaceholder="CTO at Acme 2019-22"
              doneTitle="Vouch published"
              extra={<LetterField value={letter} onChange={setLetter} candidate={candidate} />}
              // The letter rides with the record: one transaction, paid by the relay. A long one is
              // kept by its hash and the hash goes on chain.
              description={async () => {
                const text = letter.trim();
                if (!text) return undefined;
                return letterBytes(text) > LETTER_MAX ? (await api.storeLetter(text)).ref : text;
              }}
              onPublished={(p) => {
                setPublished(p);
                if (p.letterWritten) setLetterState("done");
                // An older relay writes no letter; then it is the wallet's own transaction, as before.
                else if (p.name && letter.trim()) void writeLetter(p.name, letter.trim());
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
            required={askedFor.map((d) => parseRequirement(d).domain)}
          />
        )}

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
                : `Published, but the letter was not written: ${letterError}`}
          </p>
        )}

        {stage === "done" && published?.name && letterState !== "done" && (
          <LetterForm api={api} candidate={candidate} name={published.name} getSigner={getSigner} />
        )}

        {stage === "done" && published && (
          <div data-testid="vouch-done">
            <h3>Published</h3>
            {published.solicited === false && !withdraw && (
              <p className="warning" data-testid="vouch-done-unsolicited">
                Not counted as one {candidate} asked for: {published.unsolicitedReason}. Ask {candidate} for
                an invitation naming your account and publish again.
              </p>
            )}
            <p>
              <code>{published.name}</code>
              {handle && (
                <>
                  {" "}
                  · signed by{" "}
                  <code>
                    {handle}.{root?.parentName}
                  </code>
                </>
              )}
            </p>
            <p>
              <Link href={`/p/${candidate}`}>{candidate}&apos;s page →</Link> ·{" "}
              <Link href="/me">Your page →</Link>
            </p>
          </div>
        )}
      </div>

      <p className="row stepper-actions">
        <button
          type="button"
          onClick={() => setChosen(steps[Math.max(0, current - 1)]!.id)}
          disabled={current === 0}
          data-testid="step-back"
        >
          ← Back
        </button>
        {current === steps.length - 1 ? (
          // The rail ends here: a grey Next reads as stuck, so the last step offers where to go.
          published ? (
            <Link href={`/p/${candidate}`} className="button primary" data-testid="done-cta">
              See it on {candidate}&apos;s page →
            </Link>
          ) : null
        ) : (
          <button
            type="button"
            className="primary"
            onClick={() => setChosen(steps[Math.min(steps.length - 1, current + 1)]!.id)}
            data-testid="step-next"
          >
            Next →
          </button>
        )}
      </p>
      {letterTx && <TxDone title="Letter written" hash={letterTx} onClose={() => setLetterTx(undefined)} />}
    </section>
  );
}
