"use client";

import Link from "next/link";
import type { Address } from "viem";
import type { Api, WalletDashboard } from "@/lib/api";
import { CopyButton } from "@/app/CopyButton";
import { useReverse } from "@/lib/hooks";

type Props = { api: Api; wallet: Address | undefined; dash: WalletDashboard };

/**
 * What the rest of the world sees. Everything here is a read any client can make without this app, which
 * is the point: the profile is a convenience, the names are the product.
 */
export function OnChain({ api, wallet, dash }: Props) {
  const reverse = useReverse(api, wallet);
  const names = [
    ...dash.names.filter((n) => n.live).map((n) => ({ name: n.ensName, what: n.payload || "your name" })),
    ...dash.links
      .filter((l) => l.live && l.ensName)
      .map((l) => ({
        name: l.ensName as string,
        // A private account has a name too, and it says something narrower: that you are there at all.
        what: l.optedIn ? `${l.domain} — you are there, not which account` : `${l.domain}, in the open`,
      })),
  ];
  const masked = dash.links.filter((l) => l.live && !l.ensName);

  return (
    <details data-testid="onchain">
      <summary className="muted">How these appear on chain</summary>

      {names.length === 0 ? (
        <p className="muted">Nothing yet.</p>
      ) : (
        <ul className="acct" data-testid="onchain-names">
          {names.map((n) => (
            <li key={n.name}>
              <span className="acct-who">
                <Link href={`/v/${n.name}`}>
                  <code>{n.name}</code>
                </Link>
              </span>
              <small className="muted">{n.what}</small>
              <span className="acct-state">
                <CopyButton text={n.name} label="Copy" />
              </span>
            </li>
          ))}
        </ul>
      )}

      {masked.length > 0 && (
        <p className="muted" data-testid="onchain-masked">
          {masked.map((l) => l.domain).join(", ")} attested privately — no name published.
        </p>
      )}

      <h3>Asked the other way round</h3>
      {reverse.data?.name ? (
        <div data-testid="reverse">
          <p>
            Your address resolves to <code>{reverse.data.name}</code> — from your record, needing no reverse
            registry.
          </p>
          {reverse.data.primary ? (
            <p className="muted" data-testid="primary-name">
              Wallets asking ENS directly show <code>{reverse.data.primary}</code>, your primary name.
            </p>
          ) : (
            <p className="muted" data-testid="primary-name">
              No primary name set in ENS; the answer above comes from your record.
            </p>
          )}
          {reverse.data.names.length > 1 && (
            <p className="muted" data-testid="reverse-names">
              {reverse.data.names.length} names, each a record this wallet holds.
            </p>
          )}
        </div>
      ) : (
        <p className="muted" data-testid="reverse">
          No name yet.
        </p>
      )}
    </details>
  );
}
