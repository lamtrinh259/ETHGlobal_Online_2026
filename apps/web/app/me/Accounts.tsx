"use client";

import { useMemo, useState } from "react";
import { useLinkAccount, usePrivy } from "@privy-io/react-auth";
import { AttestFlow } from "@/app/AttestFlow";
import { Modal } from "@/app/Modal";
import type { WalletDashboard } from "@/lib/api";
import { connectedAccounts, domainFor } from "@/lib/identity";
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
  const domains = (contracts.data?.instances ?? []).map((i) => i.domain);
  // Where each account would be attested in this deployment: `x.com` where the namespace is deployed,
  // the flat platform where it is not, and nothing at all when neither exists.
  const connected = connectedAccounts(user).map((a) => ({ ...a, target: domainFor(a, domains) }));
  const live = new Map(links.filter((l) => l.live).map((l) => [l.domain, l]));

  const connectors = [
    { label: "X", run: linkTwitter, domain: "x" },
    { label: "GitHub", run: linkGithub, domain: "github" },
    { label: "Telegram", run: linkTelegram, domain: "telegram" },
    { label: "Discord", run: linkDiscord, domain: "discord" },
    { label: "Google", run: linkGoogle, domain: "google" },
  ].filter((c) => !connected.some((a) => a.domain === c.domain));

  return (
    <div id="link">
      <p className="muted">
        A reference carries weight because you can show how you know the person. Attesting an account records
        that you control one — masked, so the chain never says which.
      </p>

      {connected.length > 0 && (
        <ul className="acct" data-testid="accounts">
          {connected.map((a) => {
            const onChain = a.target ? live.get(a.target) : undefined;
            return (
              <li key={a.domain} data-testid={`account-${a.domain}`}>
                <span className="acct-who">{a.label}</span>
                <small className="muted">{a.domain}</small>
                {onChain ? (
                  <span className="acct-state acct-on">
                    {onChain.ensName ? (
                      <>
                        <code>{onChain.ensName}</code> · {onChain.optedIn ? "private" : "public"}
                      </>
                    ) : onChain.nameless === "not-a-label" ? (
                      "attested · public, but this handle cannot be an ENS label"
                    ) : onChain.optedIn && !handle ? (
                      "attested · private · claim your name below and this gets one too"
                    ) : (
                      "attested · private"
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
                  <>
                    <span className="acct-state">not attested</span>
                    <button onClick={() => setAttesting(a.target)} data-testid={`attest-${a.domain}`}>
                      Attest
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {connectors.length > 0 && (
        <p className="row">
          <small className="muted">{connected.length > 0 ? "Add another:" : "Connect one:"}</small>
          {connectors.map((c) => (
            <button key={c.domain} onClick={() => c.run()}>
              {c.label}
            </button>
          ))}
        </p>
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
