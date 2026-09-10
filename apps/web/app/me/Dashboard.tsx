"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { formatEther, type Address } from "viem";
import { WITHDRAWN } from "@ketsuban/registrar";
import { useWebConfig } from "@/app/providers";
import { CopyButton } from "@/app/CopyButton";
import { fmtUtc, short } from "@/app/ui";
import { apiFor, useVerification, useVouches, useWalletDashboard } from "@/lib/hooks";
import type { Signer } from "@/lib/chain";
import { nameRows, needsAttention } from "@/lib/journey";
import { vouchRequest } from "@/lib/profile";
import { Step } from "@/app/Step";
import { ProfileHeader } from "./ProfileHeader";
import { profileScore } from "@/lib/score";
import { AttestFlow } from "@/app/AttestFlow";
import { Modal } from "@/app/Modal";
import { questionFor, questionTitle } from "@/lib/questions";
import { Accounts } from "./Accounts";
import { InviteLink } from "./InviteLink";
import { OwnName } from "./OwnName";
import { OnChain } from "./OnChain";
import { ReadPermission } from "./ReadPermission";
import { ProfileEditor } from "./ProfileEditor";
import { ReferSomeone } from "./ReferSomeone";
import { ENOUGH_WEI, FundWallet } from "./FundWallet";

/**
 * The candidate's and voucher's own page, as a sequence rather than a pile: who you are, what you
 * answered, which accounts back you, and the references. Everything that is plumbing — gas, ENS text
 * records, aliases, view codes — sits under "Advanced", because it is not how anyone starts.
 */
export function Dashboard() {
  const config = useWebConfig();
  const router = useRouter();
  const api = useMemo(() => apiFor(config), [config]);
  const { ready, authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const embedded = wallets.find((w) => w.walletClientType === "privy") ?? wallets[0];
  const wallet = embedded?.address as Address | undefined;
  const getSigner = async (): Promise<Signer> => {
    if (!embedded) throw new Error("no wallet");
    // A browser wallet can refuse this; the write path asks again and says which network to pick.
    await embedded.switchChain(config.chainId).catch(() => undefined);
    return {
      provider: await embedded.getEthereumProvider(),
      account: embedded.address as Address,
      chainId: config.chainId,
    };
  };

  // After publishing, the record has to reach the index before this page can show it.
  const [awaiting, setAwaiting] = useState<string>();
  const dash = useWalletDashboard(api, wallet, !!awaiting);
  // The wait ends as soon as the record shows up, whichever domain it was for.
  useEffect(() => {
    if (!awaiting || !dash.data) return;
    const arrived = [...dash.data.names, ...dash.data.links].some((r) => r.domain === awaiting && r.live);
    if (arrived) setAwaiting(undefined);
  }, [awaiting, dash.data]);

  const rows = nameRows(dash.data, config.instances);
  const root = config.instances[0];
  const [rootRow, ...subjectRows] = rows;
  const handle = rootRow?.live ? rootRow.ensName.split(".")[0] : undefined;
  const received = useVouches(api, handle);
  const rootVerification = useVerification(api, rootRow?.live ? rootRow.ensName : "");
  const rootProfile = rootVerification.data?.profile;
  const liveVouchers = (received.data?.vouches ?? [])
    .filter((v) => v.live && v.statement !== WITHDRAWN)
    .filter((v, i, all) => all.findIndex((o) => o.voucher === v.voucher) === i);
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
  // One number at the top: what a verifier can check, weighted by how much they weigh it.
  const scored = profileScore({
    hasName: !!handle,
    accounts: d.links.filter((l) => l.live).length,
    profile: {
      avatar: rootProfile?.avatar ?? "",
      description: rootProfile?.description ?? "",
      url: rootProfile?.url ?? "",
    },
    references: liveVouchers.length,
  });
  const liveLinks = d.links.filter((l) => l.live);
  const answered = subjectRows.filter((r) => r.live?.payload);
  // The wait is over as soon as the record shows up, whichever domain it was for.
  if (
    awaiting &&
    [...rows, ...d.links].some(
      (r) => ("domain" in r ? r.domain : "") === awaiting && ("live" in r ? r.live : true)
    )
  ) {
    setAwaiting(undefined);
  }

  return (
    <>
      <ProfileHeader
        name={rootRow?.live ? rootRow.ensName : undefined}
        handle={handle}
        profile={rootProfile ?? undefined}
        humanity={rootVerification.data?.humanity ?? null}
        score={scored.score}
        parts={scored.parts}
        onClaim={() => setPublishing({ domain: root!.domain, title: "Claim your name" })}
        editor={
          rootRow?.live ? (
            <>
              {wallet && BigInt(d.balance) < ENOUGH_WEI && (
                <div className="warning" data-testid="profile-needs-gas">
                  <FundWallet api={api} wallet={wallet} balance={d.balance} topup={d.gasTopup} />
                </div>
              )}
              <ProfileEditor api={api} name={rootRow.ensName} getSigner={getSigner} />
            </>
          ) : undefined
        }
        accounts={
          <>
            <Accounts
              links={d.links}
              handle={handle}
              awaiting={awaiting}
              onPublished={(domain) => {
                setAwaiting(domain);
                void dash.refetch();
              }}
            />
            <OnChain api={api} wallet={wallet} dash={d} />
          </>
        }
      />

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
          <p className="muted">Write references for people who have claimed nothing yet.</p>
          <p>
            <Link href="/vouch">Write a reference →</Link>
          </p>
        </section>
      )}

      <Step anchor="refer" title="References given" state={d.given.length > 0 ? "done" : "now"}>
        <ReferSomeone
          api={api}
          onGo={(who, ask) => router.push(`/vouch/${who}${ask ? `?ask=${encodeURIComponent(ask.id)}` : ""}`)}
        />
        {subjectRows.length > 0 && (
          <details data-testid="answers-advanced">
            <summary className="muted">Your own answers</summary>
            <ul className="acct" data-testid="answers">
              {subjectRows.map((r) => (
                <li key={r.domain} data-testid={`answer-${r.domain}`}>
                  {/* The question, not the domain it lives in: nobody outside this repo knows `kju-is`. */}
                  <span className="acct-id">
                    <strong>{questionTitle(r.domain)}</strong>
                    <small className="muted">
                      {r.live?.payload ? `“${r.live.payload}”` : "not answered"} · {r.ensName}
                    </small>
                  </span>
                  <span className="acct-state">
                    <button
                      className="linkish"
                      onClick={() =>
                        setPublishing({
                          domain: r.domain,
                          title: questionTitle(r.domain),
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
          </details>
        )}
        {d.given.length > 0 && (
          <>
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

      <Step
        anchor="references"
        title="References received"
        state={liveVouchers.length > 0 ? "done" : handle ? "now" : "todo"}
      >
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
                    <span key={v.voucher}>
                      {i > 0 && ", "}
                      <Link href={`/p/${v.voucher}`}>{v.voucher}</Link>
                      {/* Each reference is a name in your own namespace, readable without this page. */}
                      {v.ensName && (
                        <>
                          {" ("}
                          <Link href={`/v/${v.ensName}`}>
                            <code>{v.ensName}</code>
                          </Link>
                          {")"}
                        </>
                      )}
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
          <p className="muted">Claim a name first.</p>
        )}
      </Step>

      <div id="sharing">
        {rootRow?.live && <ReadPermission api={api} links={d.links} name={rootRow.ensName} />}
      </div>

      {publishing && (
        <Modal title={publishing.title} onClose={() => setPublishing(undefined)}>
          <AttestFlow
            key={publishing.domain}
            fixedDomain={publishing.domain}
            fixedHandle={handle}
            title=""
            answerLabel={publishing.answer}
            onPublished={(p) => {
              setAwaiting(p.domain);
              void dash.refetch();
            }}
          />
        </Modal>
      )}

      <details className="advanced" data-testid="advanced">
        <summary>Advanced: gas, your own .eth, view codes</summary>

        <section className="card" data-testid="dash-gas">
          <h3>Gas</h3>
          <p className="muted"></p>
          {wallet && <FundWallet api={api} wallet={wallet} balance={d.balance} topup={d.gasTopup} />}
        </section>

        {handle && rootRow && (
          <>
            <OwnName
              api={api}
              wallet={wallet}
              domain={root!.domain}
              parentLabel={root!.parentLabel}
              handle={handle}
              getSigner={getSigner}
              balance={d.balance}
              topup={d.gasTopup}
            />
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
