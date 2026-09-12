"use client";

import Link from "next/link";
import { describeRequirement, whyUnsatisfiable, wrongAccount } from "@/lib/invite";
import { connectedAccounts, type LinkedAccounts } from "@/lib/identity";
import { parseRequirement, platformOf } from "@ketsuban/registrar";
import { useMemo, useState } from "react";
import { useLinkAccount, usePrivy, useWallets } from "@privy-io/react-auth";
import type { Address } from "viem";
import { AttestFlow, type Published } from "@/app/AttestFlow";
import { InviteTerms } from "./InviteTerms";
import { LetterForm } from "./LetterForm";
import { useWebConfig } from "@/app/providers";
import { fmtUtc } from "@/app/ui";
import { apiFor, useContracts, useDisclosures, useLetterWrite, useWalletDashboard } from "@/lib/hooks";
import type { SignedInvite } from "@ketsuban/registrar";
import type { Signer } from "@/lib/chain";
import { WITHDRAWN } from "@ketsuban/registrar";
import { VOUCH_PREFIX, voucherProgress, vouchSteps } from "@/lib/journey";
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
}: {
  candidate: string;
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
  const dash = useWalletDashboard(api, authenticated ? wallet : undefined, awaitingLink);
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
  const handle = onChain.named;
  // One real person writes a reference, or nobody does: where the deployment can check humanity, a
  // writer without a live proof is sent to pass it before a statement is asked of them.
  const needsHuman = !!contracts.data?.humanity && dash.data !== undefined && !dash.data.humanity;
  // A reference is signed by the writer's own name, so the name is the first thing, not a field on the
  // statement form.
  const needsName = dash.data !== undefined && !onChain.named;
  // The accounts the invitation asks for that somebody could hold, and which are not attested yet;
  // a masked account counts, so this is answered without publishing which account it is.
  const attestedNow = (dash.data?.links ?? []).filter((l) => l.live).map((l) => l.domain.toLowerCase());
  const askedFor = (invite?.requires ?? []).filter((d) => !whyUnsatisfiable(d, config.parentNames));
  const stillToLink = askedFor.filter((d) => !attestedNow.includes(parseRequirement(d).domain));
  // A requirement naming one account that this sign-in is not: nothing to link can change it.
  const notYou = askedFor
    .map((d) => wrongAccount(d, connectedAccounts(user as LinkedAccounts | null | undefined)))
    .filter((why): why is string => !!why);
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
  const humanityDone = !!dash.data?.humanity;

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

      {/*
        What the invitation asks for, before signing in rather than after.
        Somebody opening a link should be able to see what is being asked of them while deciding
        whether to start at all: the accounts are linked on their own profile, which is a detour, and
        finding that out three steps in is how a writer ends up publishing something that does not
        count. Whether they hold them is a question only their wallet can answer, so that part waits.
      */}
      {(invite?.requires.length ?? 0) > 0 && stage === "signin" && (
        <p className={impossibleAsk ? "warning" : "muted"} data-testid="invite-preview">
          {candidate} asked for a reference from someone who has attested{" "}
          <strong>{invite?.requires.join(" and ")}</strong>.{" "}
          {impossibleAsk
            ? `${impossibleAsk} Write the reference if you mean to — it is published either way — but it cannot count as one ${candidate} asked for, so ask them for a new link.`
            : "A masked account counts, so this need not say which account it is."}
          {!impossibleAsk && (
            <>
              {" "}
              {/* The thing to do, before three steps in: linking happens on the profile page, which
                  sends them back here with the invitation. */}
              <Link
                href={`/me?then=${encodeURIComponent(`/vouch/${candidate}${inviteCode ? `?invite=${inviteCode}` : ""}`)}#link`}
                data-testid="link-required-preview"
              >
                Sign in and link {(invite?.requires.length ?? 0) > 1 ? "them" : "it"}, and this brings you
                back →
              </Link>
            </>
          )}
        </p>
      )}

      {loading && <p className="muted">loading…</p>}

      {/* Signing in writes nothing, so the gate stands in the root name domain rather than a platform
          this deployment may not even hold. */}
      {!loading && stage === "signin" && (
        <AttestFlow fixedDomain={root?.domain ?? ""} title="Sign in to begin" hideForm />
      )}

      {/* One card for everything a writer proves first, and it stays: a step done folds up with its
          confirmation inside, the next opens under it, and the statement form arrives below. */}
      {!loading &&
        authenticated &&
        !published &&
        root &&
        (needsName || claimedHere || askedFor.length > 0 || contracts.data?.humanity) && (
        <section className="card" data-testid="onboarding-gate">
          <h2>Before you write for {candidate}</h2>
          <p>
            A reference here is signed by your own permanent name, and it is worth something because whoever
            writes it has shown, once, how they know the person. Done right here; this page continues by
            itself.
          </p>
          <details className="step" open={needsName || claimedHere}>
            <summary data-testid="step-name">{onChain.named ? "✓ " : ""}Your name</summary>
            <p>
              {onChain.named ? (
                <>
                  Yours is <code>{onChain.named}.{root.parentName}</code>; every reference you write is signed
                  by it.
                </>
              ) : (
                <>
                  Pick the name every reference you write is signed by: <code>you.{root.parentName}</code>,
                  yours for good, and the same one every later reference reuses.
                </>
              )}
            </p>
            {(needsName || claimedHere) && (
              <AttestFlow
                key="name"
                fixedDomain={root.domain}
                title=""
                onPublished={() => {
                  setClaimedHere(true);
                  setAwaitingLink(true);
                  void dash.refetch();
                }}
              />
            )}
          </details>
          {askedFor.length > 0 && (
            <details className="step" open={stillToLink.length > 0 || notYou.length > 0 || !!attesting}>
              <summary data-testid="step-accounts">
                {stillToLink.length === 0 && notYou.length === 0 ? "✓ " : ""}The account you know {candidate}{" "}
                from
              </summary>
              <p>
                {candidate} asked for references from people who hold{" "}
                <strong>{askedFor.map(describeRequirement).join(" and ")}</strong>. Sign in to{" "}
                {askedFor.length > 1 ? "each" : "it"} and <em>Sign &amp; publish</em>. The account is attested to
                your wallet on chain and stays masked: the reference shows it came from someone who holds such an
                account, never which one.
              </p>
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
                  const todo = stillToLink.includes(d);
                  return (
                    <li key={d} className={todo ? "todo" : "done"}>
                      {describeRequirement(d)}
                      {!todo ? " — attested" : linked ? " — linked; sign and publish below" : " — not attested yet"}
                      {todo && !linked && linkFor[platform] && (
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
                <p className="warning" data-testid="not-you">
                  {notYou.join(" ")} You can still write a reference, marked as one {candidate} did not ask for;
                  or ask them for a link meant for you.
                </p>
              )}
              {(attesting ?? stillToLink[0]) && (
                <AttestFlow
                  key={attesting ?? stillToLink[0]}
                  fixedDomain={parseRequirement(attesting ?? stillToLink[0]!).domain}
                  allowLinking
                  title=""
                  onPublished={() => {
                    setAttesting(attesting ?? stillToLink[0]);
                    setAwaitingLink(true);
                    void dash.refetch();
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
            </details>
          )}
          {contracts.data?.humanity && (
            <details className="step" open={needsHuman} data-testid="humanity-gate">
              <summary data-testid="step-human">{humanityDone ? "✓ " : ""}One person, one voice</summary>
              <p>
                A reference here means one verified human wrote it. World&apos;s Selfie Check proves that without
                telling this site who you are; once per wallet, and it is the platform&apos;s rule, not{" "}
                {candidate}&apos;s.{humanityDone ? " Done." : " Pass it here and this page continues by itself."}
              </p>
              {needsHuman && <HumanityCheck api={api} wallet={wallet} onVerified={() => void dash.refetch()} />}
            </details>
          )}
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
          {/*
            An invitation is a request, and this is the reference answering it: publishing before what
            it asks for is linked writes something the candidate did not ask for, under their link. A
            requirement nobody could satisfy never blocks — there would be nothing to go and do — and
            referring someone uninvited is still open at /vouch/<handle>.
          */}
          {/*
            What the candidate opened for whoever holds this invitation.
            A writer who cannot see the private accounts is being asked to vouch for somebody half
            visible. The invitation is the permission, so the grant is opened by its own code rather
            than by a second secret the writer would have to be sent.
          */}
          {inviteCode &&
            shared.map((domain) => (
              <Revealed
                key={domain}
                name={`${candidate}.${root?.parentName ?? ""}`}
                domain={domain}
                linkKey={linkKeyFromInvite(inviteCode)}
              />
            ))}

          {/* What the candidate asked of the writer, before they sign rather than after. */}
          <InviteTerms
            candidate={candidate}
            parentNames={config.parentNames}
            requires={invite?.requires ?? []}
            attested={(dash.data?.links ?? []).filter((l) => l.live).map((l) => l.domain)}
            linkHref={`/me?then=${encodeURIComponent(`/vouch/${candidate}${inviteCode ? `?invite=${inviteCode}` : ""}`)}#link`}
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
