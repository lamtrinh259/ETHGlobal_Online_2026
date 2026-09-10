"use client";

import { useMemo, useState } from "react";
import { useLinkAccount, usePrivy } from "@privy-io/react-auth";
import { AttestFlow } from "@/app/AttestFlow";
import { PlatformIcon } from "@/app/PlatformIcon";
import { Modal } from "@/app/Modal";
import type { WalletDashboard } from "@/lib/api";
import { connectedAccounts, domainsFor } from "@/lib/identity";
import { useWebConfig } from "@/app/providers";
import { apiFor, useContracts } from "@/lib/hooks";

type Props = {
  links: WalletDashboard["links"];
  /** The handle this wallet holds, if any: a private account is named after it */
  handle?: string;
  /** The domain of a record that was published and has not reached the index yet */
  awaiting?: string;
  onPublished: (domain: string) => void;
};

/**
 * One card for one subject: the accounts that show how you know the people you vouch for. Connecting
 * is a Privy step, attesting is a signature, and both live on the same row so the state is obvious.
 */
export function Accounts({ links, handle, awaiting, onPublished }: Props) {
  const config = useWebConfig();
  const api = useMemo(() => apiFor(config), [config]);
  // What the deployment actually holds, read from the chain through the API. The browser's own config
  // lists only the name domains, which is not the same question.
  const contracts = useContracts(api);
  const { user } = usePrivy();
  const { linkTwitter, linkTelegram, linkGithub, linkDiscord, linkGoogle } = useLinkAccount();
  const [attesting, setAttesting] = useState<string>();
  const [adding, setAdding] = useState(false);
  const domains = (contracts.data?.instances ?? []).map((i) => i.domain);
  // Where each account would be attested in this deployment: `x.com` where the namespace is deployed,
  // the flat platform where it is not, and nothing at all when neither exists.
  const live = new Map(links.filter((l) => l.live).map((l) => [l.domain, l]));
  const connected = connectedAccounts(user).map((a) => {
    // A record written before the DNS namespace lives in the flat domain; the row must show it rather
    // than calling the account unattested while the rest of the page lists it.
    const candidates = domainsFor(a, domains);
    const onChain = candidates.map((d) => live.get(d)).find(Boolean);
    // Attested before this deployment had a namespace for it: the record stands, but nothing names it.
    // Attesting again in the DNS domain is what gives it one.
    const rename =
      onChain && !onChain.ensName && candidates[0] !== onChain.domain ? candidates[0] : undefined;
    return { ...a, target: candidates[0], onChain, rename };
  });

  const connectors = [
    { label: "X", run: linkTwitter, domain: "x" },
    { label: "GitHub", run: linkGithub, domain: "github" },
    { label: "Telegram", run: linkTelegram, domain: "telegram" },
    { label: "Discord", run: linkDiscord, domain: "discord" },
    { label: "Google", run: linkGoogle, domain: "google" },
  ].filter((c) => !connected.some((a) => a.domain === c.domain));

  return (
    <div id="link">
      <p className="muted">Attesting proves you control an account, without naming it.</p>

      {connected.length > 0 && (
        <ul className="acct" data-testid="accounts">
          {connected.map((a) => {
            const onChain = a.onChain;
            return (
              <li key={a.domain} data-testid={`account-${a.domain}`}>
                <PlatformIcon domain={onChain?.domain ?? a.target ?? a.domain} />
                <span className="acct-id">
                  <strong>{a.label}</strong>
                  {/* Two records for one platform look identical without the name each answers at. */}
                  <small className="muted">{onChain?.ensName ?? a.domain}</small>
                </span>
                {onChain && (
                  <span
                    className={`badge ${onChain.optedIn ? "badge-private" : "badge-public"}`}
                    data-testid={`badge-${onChain.domain}`}
                  >
                    {onChain.optedIn ? "private" : "public"}
                  </span>
                )}
                {onChain ? (
                  <span className="acct-state acct-on">
                    {onChain.nameless === "not-a-label" ? (
                      <small className="muted">this handle cannot be an ENS label</small>
                    ) : onChain.optedIn && !handle ? (
                      <small className="muted">claim your name below and this gets one too</small>
                    ) : null}
                    {/* Sharing is decided further down the page; a private row is where someone
                        wonders who can open it, so the way in belongs here. */}
                    {onChain.optedIn && handle && (
                      <a href="#sharing" className="linkish" data-testid={`who-reads-${onChain.domain}`}>
                        who can read it
                      </a>
                    )}
                    {a.rename && (
                      <button
                        className="linkish"
                        onClick={() => setAttesting(a.rename)}
                        data-testid={`rename-${a.domain}`}
                      >
                        give it a name
                      </button>
                    )}
                  </span>
                ) : !a.target ? (
                  <span className="acct-state" data-testid={`unmounted-${a.domain}`}>
                    this build has no namespace for {a.domain}
                  </span>
                ) : awaiting === a.target ? (
                  <span className="acct-state" data-testid={`awaiting-${a.domain}`}>
                    published · waiting for the index
                  </span>
                ) : (
                  <span className="acct-state">
                    <button onClick={() => setAttesting(a.target)} data-testid={`attest-${a.domain}`}>
                      Attest
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {connectors.length > 0 && (
        <p>
          <button onClick={() => setAdding(true)} data-testid="add-account">
            {connected.length > 0 ? "Add another account" : "Connect an account"}
          </button>
        </p>
      )}

      {/* A chooser rather than a row of buttons: five connectors inline wrapped into the account above
          and read as part of it. */}
      {adding && (
        <Modal title="Connect an account" onClose={() => setAdding(false)}>
          <p className="muted">Connect first; attesting comes after.</p>
          <ul className="acct" data-testid="connect-list">
            {connectors.map((c) => (
              <li key={c.domain}>
                <PlatformIcon domain={c.domain} />
                <span className="acct-id">
                  <strong>{c.label}</strong>
                </span>
                <span className="acct-state">
                  <button
                    onClick={() => {
                      setAdding(false);
                      c.run();
                    }}
                    data-testid={`connect-${c.domain}`}
                  >
                    Connect
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </Modal>
      )}

      {attesting && (
        <Modal
          title={`Attest ${connected.find((a) => a.domain === attesting)?.label ?? attesting}`}
          onClose={() => setAttesting(undefined)}
        >
          {/* The dialog stays open on success so the confirmation is read, not flashed. */}
          <AttestFlow
            key={attesting}
            fixedDomain={attesting}
            title=""
            onPublished={(p) => onPublished(p.domain)}
          />
        </Modal>
      )}
    </div>
  );
}
