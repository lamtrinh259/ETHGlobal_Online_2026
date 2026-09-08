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
  /** Sign-in only: render the gate and nothing else */
  hideForm?: boolean;
  /** Only platform (linked-account) domains in the picker */
  platformsOnly?: boolean;
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
  hideForm,
  platformsOnly,
  onPublished,
}: Props) {
  const config = useWebConfig();
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets } = useWallets();
  const { identityToken } = useIdentityToken();
  const { signTypedData } = useSignTypedData();
  const { linkTwitter, linkTelegram, linkGithub, linkDiscord, linkGoogle } = useLinkAccount();
  const api = useMemo(() => apiFor(config), [config]);

  const [domain, setDomain] = useState(
    fixedDomain ?? (platformsOnly ? PLATFORM_DOMAIN_NAMES[0] : config.instances[0]?.domain) ?? ""
  );
  const [handle, setHandle] = useState(fixedHandle ?? "");
  const [answer, setAnswer] = useState("");
  const [optIn, setOptIn] = useState(false);
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
      const attested = await attest.mutateAsync(toWire(intent, identityToken, signature as Hex));
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
      <p className="row muted">
        <span>
          signed in as <code>{user?.id}</code>
        </span>
        <span>
          wallet <code>{wallet ? short(wallet) : "creating…"}</code>
        </span>
        {nonce.data && (
          <span>
            {nonce.data.exists ? `renewal · next nonce ${nonce.data.next}` : "first record in this domain"}
          </span>
        )}
        <button onClick={logout}>sign out</button>
      </p>

      {!isNameDomain && (
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
        <legend>Record</legend>
        {fixedDomain ? (
          <p className="muted">
            domain <code>{domain}</code>
            {parentName && (
              <>
                {" "}
                → <code>{parentName}</code>
              </>
            )}
          </p>
        ) : (
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
                {PLATFORM_DOMAIN_NAMES.map((d) => (
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
              {answerLabel ?? "answer (≤31 bytes, permanent)"}{" "}
              <input
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                maxLength={31}
                aria-label="answer"
              />
            </label>
          </>
        ) : (
          <label>
            <input type="checkbox" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} /> keep handle
            and platform id private (view code)
          </label>
        )}
      </fieldset>

      {nonce.data?.exists && (
        <p className="muted" data-testid="renewal-note">
          You already hold a record here. Publishing again writes a newer one (nonce {nonce.data.next}); the
          previous stays visible in the history — that is how a statement is revoked.
        </p>
      )}
      <button className="primary" onClick={run} disabled={busy || takenByOther} data-testid="publish">
        {step ? `${step}…` : nonce.data?.exists ? "Sign & update" : "Sign & publish"}
      </button>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <dl className="kv">
          <dt>record</dt>
          <dd>
            <code>
              {fromBytes32(result.record.domainName)} · nonce {result.record.nonce} · valid until{" "}
              {fmtUtc(new Date(Number(result.record.validUntil) * 1000).toISOString())}
            </code>
          </dd>
          {viewCode && (
            <>
              <dt>view code</dt>
              <dd>
                <code>{viewCode}</code>
                <br />
                <small className="muted">
                  kept in this browser — make disclosure links from your dashboard; only holders can read this
                  link
                </small>
              </dd>
            </>
          )}
          {txHash && (
            <>
              <dt>transaction</dt>
              <dd>
                <code>{txHash}</code>
              </dd>
            </>
          )}
          {txHash && isNameDomain && parentName && (
            <>
              <dt>name</dt>
              <dd>
                <a href={`/v/${handle}.${parentName}`}>
                  {handle}.{parentName}
                </a>
              </dd>
            </>
          )}
        </dl>
      )}
    </div>
  );
}
