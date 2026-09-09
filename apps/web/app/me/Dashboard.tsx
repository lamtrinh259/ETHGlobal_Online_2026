"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { formatEther, type Address } from "viem";
import { WITHDRAWN } from "@ketsuban/registrar";
import { useWebConfig } from "@/app/providers";
import { CopyButton } from "@/app/CopyButton";
import { fmtUtc, short } from "@/app/ui";
import { apiFor, useGasTopup, useVouches, useWalletDashboard } from "@/lib/hooks";
import type { Signer } from "@/lib/chain";
import { nameRows, needsAttention } from "@/lib/journey";
import { vouchRequest } from "@/lib/profile";
import { Step } from "@/app/Step";
import { AttestFlow } from "@/app/AttestFlow";
import { Modal } from "@/app/Modal";
import { questionFor } from "@/lib/questions";
import { Accounts } from "./Accounts";
import { InviteLink } from "./InviteLink";
import { OwnName } from "./OwnName";
import { OnChain } from "./OnChain";
import { Privacy } from "./Privacy";
import { ProfileEditor } from "./ProfileEditor";

/**
 * The candidate's and voucher's own page, as a sequence rather than a pile: who you are, what you
 * answered, which accounts back you, and the references. Everything that is plumbing — gas, ENS text
 * records, aliases, view codes — sits under "Advanced", because it is not how anyone starts.
 */
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
  const root = config.instances[0];
  const [rootRow, ...subjectRows] = rows;
  const handle = rootRow?.live ? rootRow.ensName.split(".")[0] : undefined;
  const received = useVouches(api, handle);
  const liveVouchers = [
    ...new Set(
      (received.data?.vouches ?? []).filter((v) => v.live && v.statement !== WITHDRAWN).map((v) => v.voucher)
    ),
  ];
  const siteUrl = typeof window === "undefined" ? "" : window.location.origin;
  // Claiming a name and answering a question are decisions, so each opens a dialog rather than
  // unfolding another form into the page.
  const [publishing, setPublishing] = useState<{ domain: string; title: string; answer?: string }>();

  if (!ready) return <p className="muted">loading…</p>;
  if (!authenticated) {
    return (
      <div className="card">
        <p className="muted">Sign in to see your page.</p>
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
  const attention = needsAttention(d, Date.now());
  const liveLinks = d.links.filter((l) => l.live);
  const answered = subjectRows.filter((r) => r.live?.payload);

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

      {d.org && (
        <section className="card" data-testid="dash-org">
          <h2>Issuing as {d.org.label}</h2>
          <p className="muted">
            This wallet is an onboarded organisation, so it writes references without an invitation — for
            graduates and former colleagues who have never claimed a name here. They find the letter waiting
            when they do.
          </p>
          <p>
            <Link href="/vouch">Write a reference →</Link>
          </p>
        </section>
      )}

      <Step n={1} title="Prove you are one real person" state="todo">
        <p className="muted" data-testid="humanity">
          A short face scan through World, so one person cannot run ten accounts. Partner access is pending,
          so this stays open and nothing below waits on it.
        </p>
      </Step>

      <Step n={2} title="Your accounts" state={liveLinks.length > 0 ? "done" : "now"}>
        <Accounts links={d.links} onPublished={() => void dash.refetch()} />
      </Step>

      <Step n={3} title="Your name" state={handle ? "done" : liveLinks.length > 0 ? "now" : "todo"}>
        {handle && rootRow ? (
          <p>
            <Link href={`/p/${handle}`}>
              <code>{rootRow.ensName}</code>
            </Link>{" "}
            <small className="muted">
              live until {fmtUtc(rootRow.live!.validUntil)} ·{" "}
              <button
                className="linkish"
                onClick={() => setPublishing({ domain: root!.domain, title: "Renew your name" })}
              >
                renew
              </button>
            </small>
          </p>
        ) : (
          <>
            <p className="muted">
              A name is what references attach to. An organisation may already have written for a handle you
              have not claimed — claim it and those letters attach to it.
            </p>
            <button
              className="primary"
              onClick={() => setPublishing({ domain: root!.domain, title: "Claim your name" })}
              data-testid="claim"
            >
              Claim your name
            </button>
          </>
        )}
      </Step>

      {handle && subjectRows.length > 0 && (
        <Step n={4} title="Your answers" state={answered.length === subjectRows.length ? "done" : "now"}>
          <p className="muted">Each answer is its own permanent name under yours.</p>
          <ul className="acct" data-testid="answers">
            {subjectRows.map((r) => (
              <li key={r.domain} data-testid={`answer-${r.domain}`}>
                <span className="acct-who">{r.live?.payload ? `“${r.live.payload}”` : "not answered"}</span>
                <small className="muted">{r.domain}</small>
                <span className="acct-state">
                  <button
                    className="linkish"
                    onClick={() =>
                      setPublishing({
                        domain: r.domain,
                        title: `Answer ${r.domain}`,
                        answer: questionFor(r.domain),
                      })
                    }
                  >
                    {r.live ? "change" : "answer now"}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </Step>
      )}

      <Step n={5} title="References" state={liveVouchers.length > 0 ? "done" : handle ? "now" : "todo"}>
        {handle ? (
          <>
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
            <InviteLink handle={handle} />
            <details>
              <summary className="muted">A message to send with it</summary>
              <code data-testid="vouch-request">{vouchRequest(handle, siteUrl, root?.parentName ?? "")}</code>
              <p>
                <CopyButton
                  text={vouchRequest(handle, siteUrl, root?.parentName ?? "")}
                  label="Copy the ask"
                />
              </p>
            </details>
          </>
        ) : (
          <>
            <p className="muted">References attach to a name, so that comes first.</p>
            <p>
              <button
                className="primary"
                onClick={() => setPublishing({ domain: root!.domain, title: "Claim your name" })}
              >
                Claim your name
              </button>
            </p>
          </>
        )}

        {d.given.length > 0 && (
          <>
            <h3>References you gave</h3>
            <ul className="vouches" data-testid="dash-given">
              {d.given.map((g) => (
                <li key={`${g.domain}:${g.nonce}`} className={g.live ? "live" : "expired"}>
                  <span className="vouch-who">
                    for <Link href={`/p/${g.candidate}`}>{g.candidate}</Link>
                  </span>
                  <span className="vouch-what">
                    {g.payload === WITHDRAWN ? "withdrawn" : `“${g.payload}”`}
                  </span>
                  <span className="vouch-meta muted">
                    {g.live ? "live" : "expired"} · until {fmtUtc(g.validUntil)} ·{" "}
                    <Link href={`/vouch/${g.candidate}`}>update</Link>
                    {g.live && g.payload !== WITHDRAWN && (
                      <>
                        {" · "}
                        <Link href={`/vouch/${g.candidate}?withdraw=1`}>withdraw</Link>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Step>

      <OnChain api={api} wallet={wallet} dash={d} />

      {publishing && (
        <Modal title={publishing.title} onClose={() => setPublishing(undefined)}>
          <AttestFlow
            key={publishing.domain}
            fixedDomain={publishing.domain}
            fixedHandle={handle}
            title=""
            answerLabel={publishing.answer}
            onPublished={() => void dash.refetch()}
          />
        </Modal>
      )}

      <details className="advanced" data-testid="advanced">
        <summary>Advanced: gas, ENS records, your own .eth, view codes</summary>

        <section className="card" data-testid="dash-gas">
          <h3>Gas</h3>
          <p className="muted">
            Wallet <code>{wallet && short(wallet)}</code> holds{" "}
            <code>{formatEther(BigInt(d.balance))} ETH</code>. Writing ENS records or an alias is a
            transaction you send yourself; everything else is relayed for you.
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
        </section>

        {handle && rootRow && (
          <>
            <ProfileEditor api={api} name={rootRow.ensName} getSigner={getSigner} />
            <OwnName
              api={api}
              wallet={wallet}
              domain={root!.domain}
              parentLabel={root!.parentLabel}
              handle={handle}
              getSigner={getSigner}
            />
            <Privacy links={d.links} handle={handle} />
          </>
        )}

        <section className="card">
          <h3>Every record this wallet holds</h3>
          <dl className="kv">
            {[...d.names, ...d.links].map((r) => (
              <div key={`${r.domain}:${r.nonce}`} className="kv-row">
                <dt>
                  <code>{r.domain}</code>
                </dt>
                <dd>
                  {r.payload ? `“${r.payload}” · ` : ""}
                  <span className={r.live ? "muted" : "error"}>{r.live ? "live" : "expired"}</span> until{" "}
                  {fmtUtc(r.validUntil)} · nonce {r.nonce}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </details>
      <p className="warning">{d.warning}</p>
    </>
  );
}
