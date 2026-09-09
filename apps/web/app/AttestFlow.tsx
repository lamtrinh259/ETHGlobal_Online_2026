"use client";

import { useEffect, useMemo, useState } from "react";
import {
  useIdentityToken,
  useLinkAccount,
  usePrivy,
  useSignTypedData,
  useWallets,
} from "@privy-io/react-auth";
import type { Address, Hex } from "viem";
import type { SignedInvite } from "@ketsuban/registrar";
import { PLATFORM_DOMAIN_NAMES } from "@ketsuban/registrar";
import { fromBytes32 } from "@peeramid-labs/multipass-client";
import { apiFor, useAttest, useDeliver, useNameStatus, useNonce } from "@/lib/hooks";
import { isNameDomainFor, parentNameFor } from "@/lib/journey";
import { buildIntent, intentTypedData, toWire } from "@/lib/intent";
import { loadOrCreateViewKey, openViewCode, saveViewCode } from "@/lib/keys";
import { useWebConfig } from "./providers";
import { fmtUtc, short } from "./ui";

export type Published = { handle: string; domain: string; txHash: Hex; name?: string };

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
  /** Pre-fill the answer (a withdrawal writes a fixed statement) */
  answerValue?: string;
  /** Sign-in only: render the gate and nothing else */
  hideForm?: boolean;
  /** Vouch domains: the candidate's invitation, from the link they shared */
  invite?: SignedInvite;
  /** Only platform (linked-account) domains in the picker */
  platformsOnly?: boolean;
  /** Restrict the platform picker to these domains (e.g. the ones the user has actually linked) */
  domainOptions?: string[];
  /** Show the Privy account-linking buttons (the profile does; journeys send people there instead) */
  allowLinking?: boolean;
  onPublished?: (p: Published) => void;
};

/**
 * Sign in → (link account) → sign intent → attest → deliver. The wallet-signed intent and the
 * Privy identity token are the only inputs the attester needs; nothing here talks to the chain.
 * Server state (nonce) and the two mutations go through react-query (`lib/hooks`).
 */
export function AttestFlow({
  fixedDomain,
  fixedHandle,
  title,
  answerLabel,
  answerPlaceholder,
  answerValue,
  hideForm,
  invite,
  platformsOnly,
  domainOptions,
  allowLinking,
  onPublished,
}: Props) {
  const config = useWebConfig();
  const { ready, authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const { identityToken } = useIdentityToken();
  const { signTypedData } = useSignTypedData();
  const { linkTwitter, linkTelegram, linkGithub, linkDiscord, linkGoogle } = useLinkAccount();
  const api = useMemo(() => apiFor(config), [config]);

  const platforms = domainOptions?.length ? domainOptions : [...PLATFORM_DOMAIN_NAMES];
  const [domain, setDomain] = useState(
    fixedDomain ?? (platformsOnly ? platforms[0] : config.instances[0]?.domain) ?? ""
  );
  const [handle, setHandle] = useState(fixedHandle ?? "");
  const [answer, setAnswer] = useState(answerValue ?? "");
  // A linked account is masked by default: the commitment proves control, the handle stays private.
  const [optIn, setOptIn] = useState(!fixedDomain || !config.nameDomains.includes(fixedDomain));
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState<string>();
  const [viewCode, setViewCode] = useState<Hex>();

  const embedded = wallets.find((w) => w.walletClientType === "privy") ?? wallets[0];
  const wallet = embedded?.address as Address | undefined;
  const isNameDomain = isNameDomainFor(domain, config);
  const parentName = parentNameFor(domain, config);

  const nonce = useNonce(api, wallet, domain);
  const [debounced, setDebounced] = useState(handle);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(handle), 350);
    return () => clearTimeout(t);
  }, [handle]);
  const nameStatus = useNameStatus(api, domain, debounced, isNameDomain && !fixedHandle);
  const answerBytes = new TextEncoder().encode(answer).length;
  const takenByOther =
    !!nameStatus.data?.taken && !!wallet && nameStatus.data.wallet?.toLowerCase() !== wallet.toLowerCase();
  const attest = useAttest(api);
  const deliver = useDeliver(api, wallet, domain);

  useEffect(() => {
    if (isNameDomain) setOptIn(false);
  }, [isNameDomain]);

  const busy = signing || attest.isPending || deliver.isPending;
  const error = signError ?? attest.error?.message ?? deliver.error?.message;
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
      const refreshed = nonce.data ? undefined : await nonce.refetch();
      const state = nonce.data ?? refreshed?.data;
      if (!state) {
        const why = refreshed?.error?.message ?? nonce.error?.message ?? "no response";
        throw new Error(`could not read the on-chain nonce from ${config.apiUrl}: ${why}`);
      }
      const { next } = state;
      const viewKey = loadOrCreateViewKey();
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
      const { txHash } = await deliver.mutateAsync(attested);
      onPublished?.({
        handle,
        domain,
        txHash,
        name: isNameDomain && parentName ? `${handle}.${parentName}` : undefined,
      });
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

  return (
    <div className="card">
      {title && <h2>{title}</h2>}
      {!isNameDomain && allowLinking && (
        <fieldset>
          <legend>Link an account</legend>
          <div className="row">
            <button onClick={() => linkTwitter()}>X</button>
            <button onClick={() => linkTelegram()}>Telegram</button>
            <button onClick={() => linkGithub()}>GitHub</button>
            <button onClick={() => linkDiscord()}>Discord</button>
            <button onClick={() => linkGoogle()}>Google</button>
          </div>
        </fieldset>
      )}

      <fieldset>
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
            <label>
              {answerLabel ?? "A few words, permanent"}{" "}
              <input
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder={answerPlaceholder ?? "a few words"}
                aria-label="answer"
              />
              <small className={answerBytes > 31 ? "error" : "muted"} data-testid="answer-bytes">
                {answerBytes}/31 characters used{answerBytes > 31 ? " — too long to fit in the name" : ""}
              </small>
            </label>
          </>
        ) : (
          <label>
            <input type="checkbox" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} /> keep the
            account private — the chain records that you control one, not which
          </label>
        )}
      </fieldset>

      {nonce.data?.exists && (
        <p className="muted" data-testid="renewal-note">
          You already hold a record here. Publishing again writes a newer one (nonce {nonce.data.next}); the
          previous stays visible in the history — that is how a statement is revoked.
        </p>
      )}
      <button
        className="primary"
        onClick={run}
        disabled={busy || takenByOther || answerBytes > 31}
        data-testid="publish"
      >
        {step ? `${step}…` : nonce.data?.exists ? "Sign & update" : "Sign & publish"}
      </button>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <div className="done" data-testid="published">
          {txHash ? (
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
    </div>
  );
}
