"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Hex } from "viem";
import type { WalletDashboard } from "@/lib/api";
import { loadViewCodes } from "@/lib/keys";
import { disclosureLink } from "@/lib/profile";
import { CopyButton } from "@/app/CopyButton";

type Props = { links: WalletDashboard["links"]; handle: string };

/**
 * The candidate's privacy policy in practice: masked links show only a commitment on-chain; a
 * disclosure link carries the view code and unmasks one platform for whoever holds it.
 */
export function Privacy({ links, handle }: Props) {
  const [codes, setCodes] = useState<Record<string, Hex>>({});
  useEffect(() => setCodes(loadViewCodes()), []);
  const siteUrl = typeof window === "undefined" ? "" : window.location.origin;
  const live = links.filter((l) => l.live);

  return (
    <section className="card" data-testid="dash-privacy">
      <h2>Privacy</h2>
      <p className="muted">
        Masked links are stored as a commitment — the chain shows that you control <em>an</em> account on the
        platform, not which one. You disclose per recipient: a disclosure link carries the view code.
      </p>
      {live.length === 0 ? (
        <p>
          No live links. <Link href="/claim">Link one →</Link>
        </p>
      ) : (
        <ul className="vouches">
          {live.map((l) => {
            const code = codes[l.domain];
            const url = code ? disclosureLink(siteUrl, handle, l.domain, code) : undefined;
            return (
              <li key={`${l.domain}:${l.name}`} className="live" data-testid={`privacy-${l.domain}`}>
                <span className="vouch-who">
                  <code>{l.domain}</code> · {l.optedIn ? "masked" : `public: ${l.name}`}
                </span>
                {l.optedIn && url && (
                  <span className="vouch-meta">
                    <CopyButton text={url} label="Copy disclosure link" />{" "}
                    <a href={url} target="_blank" rel="noreferrer">
                      preview
                    </a>
                  </span>
                )}
                {l.optedIn && !url && (
                  <span className="vouch-meta muted">
                    view code not in this browser — <Link href="/claim">re-link</Link> to get it again
                  </span>
                )}
                {!l.optedIn && (
                  <span className="vouch-meta muted">
                    public on-chain: anyone resolving <code>ketsuban:link:{l.domain}</code> reads it
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
