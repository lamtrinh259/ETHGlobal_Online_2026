"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { connectedAccounts, domainFor, type LinkedAccounts } from "@/lib/identity";
import { PLATFORM_DNS_NAMES, platformOf } from "@ketsuban/registrar";
import {
  useIdentityToken,
  useLinkAccount,
  usePrivy,
  useSignTypedData,
  useWallets,
} from "@privy-io/react-auth";
import type { Address, Hex } from "viem";
import type { SignedInvite } from "@ketsuban/registrar";
import { fromBytes32 } from "@peeramid-labs/multipass-client";
import { Hint } from "./Hint";
import { apiFor, useAttest, useContracts, useDeliver, useNameStatus, useNonce } from "@/lib/hooks";
import { isNameDomainFor, parentNameFor, VOUCH_PREFIX } from "@/lib/journey";
import { buildIntent, intentTypedData, toWire } from "@/lib/intent";
import { loadOrCreateViewKey, openViewCode, saveViewCode } from "@/lib/keys";
import { Switch } from "./Switch";
import { TxDone } from "./TxDone";
import { useWebConfig } from "./providers";
import { fmtUtc, short } from "./ui";

export type Published = {
  handle: string;
  domain: string;
  txHash: Hex;
  name?: string;
  /** Whether the letter went on chain in the same transaction as the record */
  letterWritten?: boolean;
  /** For a reference: false when it was published but does not count as asked for, with the reason */
  solicited?: boolean;
  unsolicitedReason?: string;
};

type Props = {
  /** Lock the domain (journeys sequence domains themselves) */
  fixedDomain?: string;
  /** Reuse a handle claimed earlier in the journey */
  fixedHandle?: string;
  title?: string;
  /** Label for the answer field on name domains */
  answerLabel?: string;
  /** Example text in the answer field */
  answerPlaceholder?: string;
  /** A short explanation of what the answer does, attached to its label */
  answerHint?: string;
  /** Pre-fill the answer (a withdrawal writes a fixed statement) */
  answerValue?: string;
  /** Rendered under the answer, for a caller with a second field belonging to the same decision */
  extra?: ReactNode;
  /** Sign-in only: render the gate and nothing else */
  hideForm?: boolean;
  /** Vouch domains: the candidate's invitation, from the link they shared */
  invite?: SignedInvite;
  /** Why publishing is refused right now; the button stays disabled and this is said above it */
  blocked?: ReactNode;
  /** Only platform (linked-account) domains in the picker */
  platformsOnly?: boolean;
  /** Restrict the platform picker to these domains (e.g. the ones the user has actually linked) */
  domainOptions?: string[];
  /** Show the Privy account-linking buttons (the profile does; journeys send people there instead) */
  allowLinking?: boolean;
  /** The letter to write with the record, resolved when the record is delivered; nothing means no letter */
  description?: () => Promise<string | undefined>;
  /** What the confirmation dialog calls this write ("Name claimed", "Reference published") */
  doneTitle?: string;
  onPublished?: (p: Published) => void;
};

/**
 * Sign in → (link account) → sign intent → attest → deliver. The wallet-signed intent and the
 * Privy identity token are the only inputs the attester needs; nothing here talks to the chain.
 * Server state (nonce) and the two mutations go through react-query (`lib/hooks`).
 */
const PLATFORM_LABELS: Readonly<Record<string, string>> = {
  x: "X",
  github: "GitHub",
  discord: "Discord",
  google: "Google",
  linkedin: "LinkedIn",
  email: "an email address",
};

/** Privy's `linkMethod` names for the platforms this deployment attests */
const LINK_METHOD_PLATFORM: Readonly<Record<string, string>> = { twitter: "x" };

export function AttestFlow({
  fixedDomain,
  fixedHandle,
  title,
  answerLabel,
  answerPlaceholder,
  answerHint,
  answerValue,
  extra,
  hideForm,
  invite,
  blocked,
  platformsOnly,
  domainOptions,
  allowLinking,
  description,
  doneTitle,
  onPublished,
}: Props) {
  const config = useWebConfig();
  const { ready, authenticated, login, user } = usePrivy();
  const { wallets } = useWallets();
  const { identityToken } = useIdentityToken();
  const { signTypedData } = useSignTypedData();
  // Linking an account is choosing it: the record's domain follows the platform that was just linked,
  // so nobody links GitHub and then publishes into a domain they never picked.
  // A link that fails used to fail in the console only; the button looked dead. The reason is said
  // under the buttons, since the usual one is a platform the Privy app has not been set up for.
  const [linkError, setLinkError] = useState<string>();
  const { linkTwitter, linkGithub, linkDiscord, linkGoogle, linkLinkedIn, linkEmail } = useLinkAccount({
    onSuccess: ({ linkMethod, linkedAccount }) => {
      setLinkError(undefined);
      // An email lands in the domain that issued the address; a platform in its own DNS name.
      const address = (linkedAccount as { address?: string } | undefined)?.address;
      const chosen =
        linkMethod === "email"
          ? address?.split("@")[1]?.toLowerCase()
          : platformDomain(LINK_METHOD_PLATFORM[linkMethod] ?? linkMethod);
      if (chosen) setDomain(chosen);
    },
    onError: (error, details) => {
      const method = details?.linkMethod
        ? (PLATFORM_LABELS[LINK_METHOD_PLATFORM[details.linkMethod] ?? details.linkMethod] ??
          details.linkMethod)
        : "the account";
      setLinkError(
        `Linking ${method} failed: ${String(error)}. If nothing opened, that platform is not enabled on this deployment's Privy app.`
      );
    },
  });
  const api = useMemo(() => apiFor(config), [config]);

  // What this deployment can actually attest into, which is a DNS name wherever the namespace is
  // deployed. The flat list is the fallback for a deployment that has no platform instances at all.
  const contracts = useContracts(api);
  // What is deployed comes from the chain when it has answered; before that, every platform's own
  // DNS name, which is where a new account lands anyway. Never the flat legacy names.
  const deployed = (contracts.data?.instances ?? config.instances)
    .map((i) => i.domain)
    .filter((d) => !isNameDomainFor(d, config));
  const offered = domainOptions?.length
    ? domainOptions
    : deployed.length
      ? deployed
      : [...new Set(Object.values(PLATFORM_DNS_NAMES))];
  const connected = connectedAccounts(user as LinkedAccounts | null | undefined);
  /**
   * Where an account on this platform is attested here; the first linked platform is the default. The
   * linked account itself is asked, because a Google account's domain is in its address.
   */
  const platformDomain = (platform: string) =>
    domainFor(connected.find((a) => a.domain === platform) ?? { domain: platform, label: "" }, offered) ??
    PLATFORM_DNS_NAMES[platform];
  const [domain, setDomain] = useState(
    fixedDomain ??
      (platformsOnly
        ? (connected.map((a) => platformDomain(a.domain)).find(Boolean) ?? offered[0])
        : config.instances[0]?.domain) ??
      ""
  );
  // The picker offers what is deployed, where each linked account would land, and whatever is chosen:
  // a select whose value is not among its options silently shows the first one instead.
  const platforms = [
    ...new Set(
      [...offered, ...connected.map((a) => platformDomain(a.domain)), domain].filter(
        (d): d is string => !!d && !isNameDomainFor(d, config)
      )
    ),
  ];
  const [handle, setHandle] = useState(fixedHandle ?? "");
  const [answer, setAnswer] = useState(answerValue ?? "");
  // A linked account is masked by default: the commitment proves control, the handle stays private.
  const [optIn, setOptIn] = useState(!fixedDomain || !isNameDomainFor(fixedDomain, config));
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState<string>();
  const [viewCode, setViewCode] = useState<Hex>();
  /** The transaction whose confirmation has been read, so closing it does not bring it back */
  const [doneRead, setDoneRead] = useState<Hex>();

  const embedded = wallets.find((w) => w.walletClientType === "privy") ?? wallets[0];
  const wallet = embedded?.address as Address | undefined;
  const isNameDomain = isNameDomainFor(domain, config);
  /*
   * A platform record attests an account the person has linked; without that account the attester
   * refuses the intent after it was signed. So the platform this domain needs is checked first, and
   * the form says which button to press instead of offering a signature that cannot succeed.
   */
  const platformNeeded = isNameDomain ? undefined : platformOf(domain);
  const holdsPlatform =
    !platformNeeded ||
    connected.some((a) =>
      platformNeeded === "email"
        ? (a.domain === "email" || a.domain === "google") && a.label.toLowerCase().endsWith(`@${domain}`)
        : a.domain === platformNeeded
    );
  const missingLink =
    platformNeeded && !holdsPlatform ? (
      <>
        Link {PLATFORM_LABELS[platformNeeded] ?? platformNeeded}
        {allowLinking ? " above" : " on your profile"} first: this record attests an account there, and none
        is linked to you yet.
      </>
    ) : undefined;
  const refused = blocked ?? missingLink;
  const parentName = parentNameFor(domain, config);

  const nonce = useNonce(api, wallet, domain);
  const [debounced, setDebounced] = useState(handle);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(handle), 350);
    return () => clearTimeout(t);
  }, [handle]);
  const nameStatus = useNameStatus(api, domain, debounced, isNameDomain && !fixedHandle);
  // A name holds 31 bytes, which is not 31 characters: an accented letter costs two, an emoji four.
  // Counting characters would promise room that is not there.
  const answerBytes = new TextEncoder().encode(answer).length;
  const answerChars = [...answer].length;
  // The root name is just a name: answers belong to the subject instances under it, and statements to a
  // candidate's vouch domain. Asking for one while claiming would write it nowhere anyone reads.
  const wantsAnswer = isNameDomain && domain !== config.instances[0]?.domain;
  const takenByOther =
    !!nameStatus.data?.taken &&
    !nameStatus.data.reserved &&
    !!wallet &&
    nameStatus.data.wallet?.toLowerCase() !== wallet.toLowerCase();
  const reserved = nameStatus.data?.handle === debounced && !!nameStatus.data?.reserved;
  const attest = useAttest(api);
  const deliver = useDeliver(api, wallet, domain);
  // Nobody has attested an account in this domain here yet, so publishing also builds its namespace:
  // a few deployments, a minute of waiting, and worth saying before the button is pressed.
  const mounting =
    !!contracts.data && domain.includes(".") && !contracts.data.instances.some((i) => i.domain === domain);

  useEffect(() => {
    if (isNameDomain) setOptIn(false);
  }, [isNameDomain]);

  const busy = signing || attest.isPending || deliver.isPending;
  const raw = signError ?? attest.error?.message ?? deliver.error?.message;
  /*
   * The attester refuses a nonce the chain has already used, and says so in its own terms. Somebody
   * reaches that message by publishing twice — most often because the first attempt timed out here and
   * landed anyway — and "nonce not increasing" tells them nothing about what to do. What happened is
   * that their record exists.
   */
  const error = raw?.includes("nonce not increasing")
    ? "This is already published — the earlier attempt reached the chain even if this page did not hear back. Reload to see it, and publish again only if you want to replace it."
    : raw;
  const step = signing
    ? "signing"
    : attest.isPending
      ? "attesting"
      : deliver.isPending
        ? "delivering"
        : undefined;

  async function run() {
    setSignError(undefined);
    attest.reset();
    deliver.reset();
    try {
      if (!wallet) throw new Error("no wallet yet — Privy is still creating it");
      if (!identityToken)
        throw new Error("no identity token — enable identity tokens in the Privy dashboard");
      /*
       * Read it again, always. A cached nonce is the one value that cannot be reused: the chain
       * refuses a record whose nonce has not increased, and a stale one spends the person's signature
       * on a request that was doomed before they gave it. Publishing twice in a session is enough to
       * go stale — the second intent carried the nonce the first had already used.
       */
      const refreshed = await nonce.refetch();
      const state = refreshed.data ?? nonce.data;
      if (!state) {
        const why = refreshed.error?.message ?? nonce.error?.message ?? "no response";
        throw new Error(`could not read the on-chain nonce from ${config.apiUrl}: ${why}`);
      }
      const viewKey = loadOrCreateViewKey();
      /*
       * Sign, attest, deliver — once with the nonce the service reports, and once more if the chain
       * says the count is higher. A record the owner deleted no longer resolves, but Multipass still
       * counts its nonce; the revert names the number, so the second signature carries it.
       */
      const attempt = async (next: bigint, retried: boolean): Promise<void> => {
        setSigning(true);
        const intent = buildIntent({
          wallet,
          domain,
          nonce: next,
          now: Math.floor(Date.now() / 1000),
          optIn,
          pubkey: viewKey.publicKey,
          handle,
          answer,
          isNameDomain,
        });
        const { signature } = await signTypedData(
          intentTypedData(intent, config.chainId, config.multipass as Address),
          {
            address: wallet,
          }
        );
        setSigning(false);
        const attested = await attest.mutateAsync(toWire(intent, identityToken, signature as Hex, invite));
        if (attested.viewCode) {
          const code = openViewCode(viewKey, attested.viewCode);
          setViewCode(code);
          saveViewCode(domain, code);
        }
        const letter = description ? await description() : undefined;
        let delivered: { txHash: Hex; letterWritten?: boolean };
        try {
          delivered = await deliver.mutateAsync(
            letter ? { result: attested, description: letter } : attested
          );
        } catch (e) {
          const onChain = /on chain (\d+)/.exec((e as Error).message)?.[1];
          if (onChain && !retried) {
            deliver.reset();
            return attempt(BigInt(onChain) + 1n, true);
          }
          throw e;
        }
        const { txHash, letterWritten } = delivered;
        onPublished?.({
          handle,
          domain,
          txHash,
          name: isNameDomain && parentName ? `${handle}.${parentName}` : undefined,
          letterWritten: !!letterWritten,
          ...(attested.solicited === undefined
            ? {}
            : { solicited: attested.solicited, unsolicitedReason: attested.unsolicitedReason }),
        });
      };
      await attempt(state.next, false);
    } catch (e) {
      setSigning(false);
      if (!attest.error && !deliver.error) setSignError((e as Error).message);
    }
  }

  if (!ready) return <p className="muted">loading…</p>;
  if (!authenticated) {
    return (
      <div className="card">
        {title && <h2>{title}</h2>}
        <p className="muted">
          Sign in to continue. An embedded wallet is created for you; you never see gas.
        </p>
        <button onClick={login} className="primary" data-testid="signin">
          Sign in
        </button>
      </div>
    );
  }
  if (hideForm) return null;

  const result = attest.data;
  const txHash = deliver.data?.txHash;
  // Once it is on chain there is nothing left to fill in: the form would only invite a second write.
  const settled = !!txHash;

  return (
    <div className="card">
      {title && <h2>{title}</h2>}
      {!settled && !isNameDomain && allowLinking && (
        <fieldset>
          <legend>Link an account</legend>
          <div className="row">
            {(
              [
                ["x", "X", linkTwitter],
                ["github", "GitHub", linkGithub],
                ["discord", "Discord", linkDiscord],
                ["google", "Google", linkGoogle],
                ["linkedin", "LinkedIn", linkLinkedIn],
                ["email", "Email", linkEmail],
              ] as const
            ).map(([platform, label, link]) => {
              const linked = connected.some((a) => a.domain === platform);
              // A second email address is a new host to attest in, so Email always links.
              const target = platform === "email" ? undefined : platformDomain(platform);
              return (
                // An account already linked is picked, not linked again; the one this record still
                // needs is the button that stands out.
                <button
                  key={platform}
                  className={platform === platformNeeded && !linked ? "primary" : undefined}
                  aria-pressed={!!target && domain === target}
                  onClick={() => (linked && target ? setDomain(target) : link())}
                >
                  {label}
                  {linked ? " · linked" : ""}
                </button>
              );
            })}
          </div>
          {linkError && (
            <p className="warning" data-testid="link-error">
              {linkError}
            </p>
          )}
        </fieldset>
      )}

      <fieldset hidden={settled}>
        <legend className={fixedDomain ? "visually-hidden" : ""}>Record</legend>
        {fixedDomain ? null : (
          <label>
            domain{" "}
            <select value={domain} onChange={(e) => setDomain(e.target.value)} aria-label="domain">
              {!platformsOnly && (
                <optgroup label="names">
                  {config.nameDomains.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label="linked accounts">
                {platforms.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
        )}
        {isNameDomain ? (
          <>
            {fixedHandle ? (
              <p>
                handle <code>{fixedHandle}</code>
              </p>
            ) : (
              <label>
                handle{" "}
                <input
                  value={handle}
                  onChange={(e) => setHandle(e.target.value.toLowerCase())}
                  placeholder="alice"
                />
                {parentName && handle && (
                  <small className="muted">
                    {" "}
                    →{" "}
                    <code>
                      {handle}.{parentName}
                    </code>
                  </small>
                )}
              </label>
            )}
            {wantsAnswer && (
              <label>
                {answerLabel ?? "A few words, permanent"} {answerHint && <Hint text={answerHint} />}{" "}
                <input
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  placeholder={answerPlaceholder ?? "a few words"}
                  aria-label="answer"
                />
                <small className={answerBytes > 31 ? "error" : "muted"} data-testid="answer-bytes">
                  {answerBytes}/31 bytes used
                  {answerChars !== answerBytes
                    ? ` · ${answerChars} characters, some cost more than one byte`
                    : ""}
                  {answerBytes > 31 ? " — too long to fit in the name" : ""}
                </small>
              </label>
            )}
            {extra}
          </>
        ) : (
          <Switch
            checked={optIn}
            onChange={setOptIn}
            label="Keep my handle private"
            hint={
              optIn
                ? "On: the record proves you control an account here, and you decide who can read which one."
                : "Off: your handle is written in the clear and anyone can read it."
            }
          />
        )}
      </fieldset>

      {!settled && nonce.data && !nonce.data.ready && (
        <p className="error" role="alert" data-testid="not-ready">
          {nonce.data.reason} — signing would fail, so the button is disabled until that is fixed.
        </p>
      )}
      {!settled && nonce.data?.exists && (
        <p className="muted" data-testid="renewal-note">
          You already hold a record here. Publishing again writes a newer one (nonce {nonce.data.next}); the
          previous stays visible in the history — that is how a statement is revoked.
        </p>
      )}
      {!settled && mounting && (
        <p className="muted" data-testid="mounting-note">
          You are the first to attest an account at <code>{domain}</code> here, so publishing also creates its
          place in the namespace — the same signature, about a minute longer.
        </p>
      )}
      {/* Said where the decision is made, not only on the front page: this is the moment somebody hands
          over an identity token, and who can read it is the thing worth knowing first. */}
      {!settled && config.confidential && (
        <p className="muted" data-testid="confidential-note">
          Verified and signed inside a <strong>Chainlink CRE enclave</strong>. Your identity token lists every
          account you have linked; it is read there and nowhere else — not by this service, not by its
          operator. Only the account above is attested.
        </p>
      )}
      {!settled && refused && (
        <p className="warning" data-testid="blocked">
          {refused}
        </p>
      )}
      {!settled && (
        <button
          className="primary"
          onClick={run}
          disabled={
            busy || takenByOther || reserved || answerBytes > 31 || nonce.data?.ready === false || !!refused
          }
          data-testid="publish"
        >
          {step === "attesting" && mounting
            ? "creating the namespace…"
            : step
              ? `${step}…`
              : nonce.data?.exists
                ? "Sign & update"
                : "Sign & publish"}
        </button>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <div className="done" data-testid="published">
          {deliver.error ? (
            <p>
              <strong>Signed, but not written.</strong> The relay refused it, so nothing changed on chain.
            </p>
          ) : txHash ? (
            <p>
              <strong>Published.</strong>{" "}
              {isNameDomain && parentName ? (
                <>
                  <a href={`/v/${handle}.${parentName}`}>
                    {handle}.{parentName}
                  </a>{" "}
                  resolves now, until{" "}
                  {fmtUtc(new Date(Number(result.record.validUntil) * 1000).toISOString())}.
                </>
              ) : (
                <>
                  Your {fromBytes32(result.record.domainName)} account is attested until{" "}
                  {fmtUtc(new Date(Number(result.record.validUntil) * 1000).toISOString())}
                  {viewCode ? ", and stays private until you share a disclosure link." : "."}
                </>
              )}
            </p>
          ) : (
            <p>
              <strong>Signed.</strong> Waiting for the record to land on chain.
            </p>
          )}
          <details>
            <summary className="muted">What was written</summary>
            <dl className="kv">
              <div className="kv-row">
                <dt>record</dt>
                <dd>
                  <code>
                    {fromBytes32(result.record.domainName)} · nonce {result.record.nonce} · valid until{" "}
                    {fmtUtc(new Date(Number(result.record.validUntil) * 1000).toISOString())}
                  </code>
                </dd>
              </div>
              {viewCode && (
                <div className="kv-row">
                  <dt>view code</dt>
                  <dd>
                    <code>{viewCode}</code>
                    <br />
                    <small className="muted">
                      kept in this browser; disclosure links are made on your profile
                    </small>
                  </dd>
                </div>
              )}
              {txHash && (
                <div className="kv-row">
                  <dt>transaction</dt>
                  <dd>
                    <code>{txHash}</code>
                  </dd>
                </div>
              )}
            </dl>
          </details>
        </div>
      )}
      {txHash && doneRead !== txHash && (
        <TxDone title={doneTitle ?? "Published"} hash={txHash} onClose={() => setDoneRead(txHash)}>
          {attest.data?.solicited === false && (
            <p className="warning" data-testid="tx-done-unsolicited">
              Published, but not counted as one {domain.slice(VOUCH_PREFIX.length)} asked for:{" "}
              {attest.data.unsolicitedReason ?? "no invitation was presented"}.
            </p>
          )}
        </TxDone>
      )}
    </div>
  );
}
