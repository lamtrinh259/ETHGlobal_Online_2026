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
    <section className="card" data-testid="onchain">
      <h2>How you appear on chain</h2>

      {names.length === 0 ? (
        <p className="muted">
          Nothing yet. Claim a name and attest an account, and both become readable here.
        </p>
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
          {masked.map((l) => l.domain).join(", ")}{" "}
          {masked.length === 1 ? "is attested but private" : "are attested but private"}, so no name is
          published for {masked.length === 1 ? "it" : "them"}. The record proves you control the account; who
          may read which one is your decision.
        </p>
      )}

      <h3>Asked the other way round</h3>
      {reverse.data?.name ? (
        <div data-testid="reverse">
          <p>
            Anything resolving your address gets <code>{reverse.data.name}</code>. That answer comes from your
            Multipass record through the instance resolver, so it needs no reverse registry and no account
            here.
          </p>
          {reverse.data.primary ? (
            <p className="muted" data-testid="primary-name">
              Wallets that ask ENS directly show <code>{reverse.data.primary}</code>, because that is what you
              set as your primary name. Nothing here can change it.
            </p>
          ) : (
            <p className="muted" data-testid="primary-name">
              You have set no primary name in ENS, so a wallet showing one would have nothing to show. The
              answer above comes from your record instead.
            </p>
          )}
          {reverse.data.names.length > 1 && (
            <p className="muted" data-testid="reverse-names">
              The same read finds {reverse.data.names.length} names for this address — the ones above —
              because each is a record this wallet holds, not an entry someone made about it.
            </p>
          )}
        </div>
      ) : (
        <p className="muted" data-testid="reverse">
          Your address resolves to no name yet; claiming one is what gives it an answer.
        </p>
      )}
    </section>
  );
}
