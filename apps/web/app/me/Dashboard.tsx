"use client";

import Link from "next/link";
import { useMemo } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import type { Address } from "viem";
import { apiFor, useGasTopup, useVouches, useWalletDashboard } from "@/lib/hooks";
import { nameRows } from "@/lib/journey";
import { vouchRequest } from "@/lib/profile";
import { CopyButton } from "@/app/CopyButton";
import { formatEther } from "viem";
import type { Signer } from "@/lib/chain";
import { ProfileEditor } from "./ProfileEditor";
import { OwnName } from "./OwnName";
import { Privacy } from "./Privacy";
import { AttestFlow } from "@/app/AttestFlow";
import { needsAttention } from "@/lib/journey";
import { useWebConfig } from "@/app/providers";
import { fmtUtc, short } from "@/app/ui";

/** Candidate/voucher status board (spec §3.2 "Track"): what this wallet holds and what it gave. */
export function Dashboard() {
  const config = useWebConfig();
  const api = useMemo(() => apiFor(config), [config]);
  const { ready, authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const embedded = wallets.find((w) => w.walletClientType === "privy") ?? wallets[0];
  const wallet = embedded?.address as Address | undefined;
  const getSigner = async (): Promise<Signer> => {
    if (!embedded) throw new Error("no wallet");
    await embedded.switchChain(config.chainId);
    return {
      provider: await embedded.getEthereumProvider(),
      account: embedded.address as Address,
      chainId: config.chainId,
    };
  };
  const dash = useWalletDashboard(api, wallet);
  const gas = useGasTopup(wallet);
  const rows = nameRows(dash.data, config.instances);
  const rootLive = rows[0]?.live ? rows[0].ensName.split(".")[0] : undefined;
  const received = useVouches(api, rootLive);
  const liveVouchers = [
    ...new Set((received.data?.vouches ?? []).filter((v) => v.live).map((v) => v.voucher)),
  ];
  const siteUrl = typeof window === "undefined" ? "" : window.location.origin;
  const root = config.instances[0];

  if (!ready) return <p className="muted">loading…</p>;
  if (!authenticated) {
    return (
      <div className="card">
        <p className="muted">Sign in to see your names.</p>
        <button onClick={login} className="primary" data-testid="signin">
          Sign in
        </button>
      </div>
    );
  }
  if (dash.isPending) return <p className="muted">reading your records…</p>;
  if (dash.error) {
    return (
      <p className="error" role="alert">
        {dash.error.message}
      </p>
    );
  }
  const d = dash.data!;
  const rootName = d.names.find((n) => n.domain === root?.domain);
  const attention = needsAttention(d, Date.now());

  return (
    <>
      {attention.length > 0 && (
        <section className="card" data-testid="dash-attention">
          <h2>Needs attention</h2>
          <ul className="checks">
            {attention.map((a) => (
              <li key={`${a.kind}:${a.label}`} className={a.daysLeft < 0 ? "no" : "ok"}>
                <span className="check-mark" aria-hidden>
                  {a.daysLeft < 0 ? "✗" : "!"}
                </span>
                {a.label} ·{" "}
                {a.daysLeft < 0 ? "expired" : `${a.daysLeft} day${a.daysLeft === 1 ? "" : "s"} left`} ·{" "}
                <Link href={a.href}>renew →</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="card" data-testid="dash-names">
        <h2>Names</h2>
        <p className="muted">
          wallet <code>{wallet && short(wallet)}</code>
        </p>
        {rows.length === 0 ? (
          <p>
            No name yet. <Link href="/claim">Claim one →</Link>
          </p>
        ) : (
          <dl className="kv">
            {rows.map((r) => (
              <div key={r.domain} className="kv-row" data-testid={`name-${r.domain}`}>
                <dt>{r.live ? <Link href={`/v/${r.ensName}`}>{r.ensName}</Link> : r.ensName}</dt>
                <dd>
                  {r.live ? (
                    <>
                      {r.live.payload ? `“${r.live.payload}” · ` : ""}
                      <span className="muted">live</span> until {fmtUtc(r.live.validUntil)} · nonce{" "}
                      {r.live.nonce} · <Link href={r.href}>{r.live.payload ? "change" : "renew"} →</Link>
                    </>
                  ) : (
                    <>
                      <span className="error">{r.expired ? "expired" : "not answered"}</span> ·{" "}
                      <Link href={r.href}>{r.expired ? "renew" : "answer now"} →</Link>
                    </>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        )}
        {rootName && (
          <p>
            <Link href={`/p/${rootName.name}`}>Your reference page →</Link>
          </p>
        )}
      </section>

      {rootName && root && (
        <section className="card" data-testid="dash-references">
          <h2>References</h2>
          {received.data ? (
            <p>
              {liveVouchers.length === 0 ? (
                <>
                  <strong>None yet.</strong> Verifiers usually want three.
                </>
              ) : (
                <>
                  <strong>{liveVouchers.length} live</strong> from{" "}
                  {liveVouchers.map((v, i) => (
                    <span key={v}>
                      {i > 0 && ", "}
                      <Link href={`/p/${v}`}>{v}</Link>
                    </span>
                  ))}
                  .
                </>
              )}
            </p>
          ) : (
            <p className="muted">reading references…</p>
          )}
          <p className="muted">Ask someone who worked with you. Paste this:</p>
          <code data-testid="vouch-request">{vouchRequest(rootName.name, siteUrl, root.parentName)}</code>
          <p>
            <CopyButton text={vouchRequest(rootName.name, siteUrl, root.parentName)} label="Copy the ask" />
          </p>
        </section>
      )}

      {rootName && root && (
        <>
          <section className="card" data-testid="dash-gas">
            <h2>Gas</h2>
            <p className="muted">
              The two actions below are transactions your wallet sends itself. Balance:{" "}
              <code>{formatEther(BigInt(d.balance))} ETH</code>
              {BigInt(d.balance) === 0n && " — empty"}.
            </p>
            {d.gasTopup.available && (
              <button
                className="primary"
                onClick={() => gas.mutate(api)}
                disabled={gas.isPending}
                data-testid="gas-topup"
              >
                {gas.isPending ? "sending…" : `Get ${formatEther(BigInt(d.gasTopup.amount))} test ETH`}
              </button>
            )}
            {gas.error && (
              <p className="error" role="alert">
                {gas.error.message}
              </p>
            )}
            {gas.isSuccess && (
              <p className="muted">
                sent · tx <code>{gas.data.hash}</code>
              </p>
            )}
            {!d.gasTopup.enabled && BigInt(d.balance) === 0n && (
              <p className="muted">Fund this address from a Sepolia faucet before saving.</p>
            )}
          </section>
          <ProfileEditor api={api} name={rootName.ensName} getSigner={getSigner} />
          <OwnName
            api={api}
            wallet={wallet}
            domain={root.domain}
            parentLabel={root.parentLabel}
            handle={rootName.name}
            getSigner={getSigner}
          />
        </>
      )}

      <section className="card" data-testid="dash-links" id="link">
        <h2>Linked accounts</h2>
        {d.links.length === 0 ? (
          <p>None yet — verifiers count live links. Add one below.</p>
        ) : (
          <ul>
            {d.links.map((l) => (
              <li key={`${l.domain}:${l.name}`}>
                <code>{l.domain}</code> {l.optedIn ? "masked" : l.name} ·{" "}
                <span className={l.live ? "muted" : "error"}>{l.live ? "live" : "expired"}</span>
              </li>
            ))}
          </ul>
        )}
        <AttestFlow platformsOnly title="Link an account" onPublished={() => void dash.refetch()} />
      </section>

      {rootName && <Privacy links={d.links} handle={rootName.name} />}

      <section className="card" data-testid="dash-given">
        <h2>References you gave</h2>
        <p className="muted">
          Your vouching history is your asset: every entry is a permanent name that carries your standing.
        </p>
        {d.given.length === 0 ? (
          <p>
            None yet. <Link href="/vouch">Vouch for someone →</Link>
          </p>
        ) : (
          <ul className="vouches">
            {d.given.map((g) => (
              <li key={`${g.domain}:${g.nonce}`} className={g.live ? "live" : "expired"}>
                <span className="vouch-who">
                  for <Link href={`/p/${g.candidate}`}>{g.candidate}</Link>
                  {g.ensName && (
                    <>
                      {" "}
                      · <code>{g.ensName}</code>
                    </>
                  )}
                </span>
                <span className="vouch-what">“{g.payload}”</span>
                <span className="vouch-meta muted">
                  {g.live ? "live" : "expired"} · until {fmtUtc(g.validUntil)} ·{" "}
                  <Link href={`/vouch/${g.candidate}`}>update</Link>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="warning">{d.warning}</p>
    </>
  );
}
