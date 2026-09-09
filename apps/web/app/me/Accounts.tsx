"use client";

import { useState } from "react";
import { useLinkAccount, usePrivy } from "@privy-io/react-auth";
import { AttestFlow } from "@/app/AttestFlow";
import { Modal } from "@/app/Modal";
import type { WalletDashboard } from "@/lib/api";
import { connectedAccounts } from "@/lib/identity";

type Props = { links: WalletDashboard["links"]; onPublished: () => void };

/**
 * One card for one subject: the accounts that show how you know the people you vouch for. Connecting
 * is a Privy step, attesting is a signature, and both live on the same row so the state is obvious.
 */
export function Accounts({ links, onPublished }: Props) {
  const { user } = usePrivy();
  const { linkTwitter, linkTelegram, linkGithub, linkDiscord, linkGoogle } = useLinkAccount();
  const [attesting, setAttesting] = useState<string>();
  const connected = connectedAccounts(user);
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
            const onChain = live.get(a.domain);
            return (
              <li key={a.domain} data-testid={`account-${a.domain}`}>
                <span className="acct-who">{a.label}</span>
                <small className="muted">{a.domain}</small>
                {onChain ? (
                  <span className="acct-state acct-on">
                    attested{onChain.optedIn ? " · private" : " · public"}
                  </span>
                ) : (
                  <>
                    <span className="acct-state">not attested</span>
                    <button onClick={() => setAttesting(a.domain)} data-testid={`attest-${a.domain}`}>
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
          <AttestFlow
            key={attesting}
            fixedDomain={attesting}
            title=""
            onPublished={() => {
              setAttesting(undefined);
              onPublished();
            }}
          />
        </Modal>
      )}
    </div>
  );
}
