"use client";

import { usePrivy, useLinkAccount } from "@privy-io/react-auth";
import { useMemo } from "react";
import { AttestFlow } from "@/app/AttestFlow";
import type { WalletDashboard } from "@/lib/api";
import { connectedAccounts } from "@/lib/identity";

/**
 * Onboarding, not part of any single reference: connect the accounts you worked from and attest one.
 * Each row shows the account the way its owner knows it, and whether it is already on chain.
 */
export function LinkAccounts({
  links,
  onPublished,
}: {
  links: WalletDashboard["links"];
  onPublished: () => void;
}) {
  const { user } = usePrivy();
  const { linkTwitter, linkTelegram, linkGithub, linkDiscord, linkGoogle } = useLinkAccount();
  const connected = connectedAccounts(user);
  const attested = useMemo(() => new Set(links.filter((l) => l.live).map((l) => l.domain)), [links]);
  const unattested = connected.filter((a) => !attested.has(a.domain));

  return (
    <section className="card" data-testid="dash-link" id="link">
      <h2>Accounts</h2>
      <p className="muted">
        These are the accounts that show how you know the people you vouch for. Connecting one tells us; the
        enclave attesting it puts a record on chain, masked unless you hand someone a view code.
      </p>
      {connected.length === 0 ? (
        <p>Nothing connected yet. Connect the account you worked from:</p>
      ) : (
        <ul className="checks" data-testid="accounts">
          {connected.map((a) => (
            <li
              key={a.domain}
              className={attested.has(a.domain) ? "ok" : "no"}
              data-testid={`account-${a.domain}`}
            >
              <span className="check-mark" aria-hidden>
                {attested.has(a.domain) ? "✓" : "!"}
              </span>
              {a.label} <small className="muted">· {a.domain}</small>{" "}
              {attested.has(a.domain) ? (
                <small className="muted">attested on chain</small>
              ) : (
                <small className="error">connected, not attested yet</small>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="row">
        <button onClick={() => linkTwitter()}>Connect X</button>
        <button onClick={() => linkTelegram()}>Connect Telegram</button>
        <button onClick={() => linkGithub()}>Connect GitHub</button>
        <button onClick={() => linkDiscord()}>Connect Discord</button>
        <button onClick={() => linkGoogle()}>Connect Google</button>
      </p>
      {connected.length > 0 && (
        <AttestFlow
          platformsOnly
          domainOptions={(unattested.length ? unattested : connected).map((a) => a.domain)}
          title={unattested.length ? "Attest an account" : "Renew an attestation"}
          onPublished={onPublished}
        />
      )}
    </section>
  );
}
