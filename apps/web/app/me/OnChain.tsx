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
      .map((l) => ({ name: l.ensName as string, what: `${l.domain}, public` })),
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
        <p data-testid="reverse">
          Anything resolving your address gets <code>{reverse.data.name}</code>. That answer comes from your
          Multipass record through the instance resolver, so it needs no reverse registry and no account here.
        </p>
      ) : (
        <p className="muted" data-testid="reverse">
          Your address resolves to no name yet; claiming one is what gives it an answer.
        </p>
      )}
    </section>
  );
}
