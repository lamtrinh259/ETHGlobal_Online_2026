import Link from "next/link";
import type { Verification } from "@/lib/api";
import { PlatformIcon } from "./PlatformIcon";
import { ProfileHead } from "./ProfileHead";
import { ReferencesGiven } from "./ReferencesGiven";
import { fmtUtc } from "./ui";

/** `x_account_control` is a field name, not a sentence. This is the same fact, said. */
function evidenceLabel(id: string): string {
  if (id === "wallet_binding") return "wallet binding";
  if (id === "humanity_attestation") return "proof of humanity";
  return id.replace(/_account_control$/, " account").replace(/_/g, " ");
}

/** Public verification view: exactly what any ENS client would read, with the warning always visible. */
export function VerifyCard({ v }: { v: Verification }) {
  const active = v.status === "active";
  // A record written before the DNS namespace existed and its replacement are one account, and the
  // page listed the evidence for both. A reader counting them would have counted the same fact twice.
  const evidence = [...new Set(v.evidence)];
  return (
    <section aria-label="verification" className="card">
      {/* Who this is comes first: the page opened on `wallet / answer / expires`, which is true and
          not what a reader came for. The verification follows it. */}
      <ProfileHead
        ensName={v.name}
        records={{
          description: v.profile?.description ?? undefined,
          url: v.profile?.url ?? undefined,
          avatar: v.profile?.avatar ?? undefined,
        }}
      />
      <p className="row">
        <span className={`badge ${active ? "ok" : "off"}`} data-testid="status">
          {active ? "active" : "no record"}
        </span>
        <small className="muted">
          instance <code>{v.instance.domain}</code> under <code>{v.instance.parentName}</code>
        </small>
      </p>
      {/* A private-branch name is a narrower claim than it looks: the account behind it stays masked. */}
      {v.branch === "private" && (
        <p className="muted" data-testid="private-branch">
          This name is in the private branch of <code>{v.instance.domain}</code>. It says the person below
          holds an account there and nothing else: which account it is stays behind a view code, and the
          records shown are their own.
        </p>
      )}
      {active && (
        <>
          {/* What they have said about others. The page used to show a bare `answer` field, which
              meant nothing once a person could answer about more than one subject. */}
          <ReferencesGiven references={v.references} />

          <section className="v-block">
            <h3>Accounts</h3>
            {v.links.length === 0 ? (
              <p className="muted">None linked.</p>
            ) : (
              <ul className="v-links" data-testid="links">
                {v.links.map((l) => (
                  <li key={l.domain}>
                    <PlatformIcon domain={l.domain} />
                    <span className="v-link-domain">{l.domain}</span>
                    {l.disclosed ? (
                      <span className="v-link-handle">
                        @{l.disclosed.handle} <small className="muted">id {l.disclosed.platformId}</small>
                      </span>
                    ) : l.optedIn ? (
                      <span
                        className="badge badge-private"
                        title="the account is verified; which account stays behind a view code"
                      >
                        masked
                      </span>
                    ) : (
                      <span className="badge badge-public">verified</span>
                    )}
                    {/* Read it back yourself: the name resolves for anyone, this page is not the source. */}
                    {l.ensName && (
                      <Link
                        className="v-link-name"
                        href={`/v/${l.ensName}`}
                        title="read it back in any ENS client"
                      >
                        <code>{l.ensName}</code>
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <dl className="kv">
            <dt>wallet</dt>
            <dd>
              <code>{v.wallet}</code>
            </dd>
            <dt>expires</dt>
            <dd>{fmtUtc(v.expiresAt)}</dd>
            <dt>humanity</dt>
            <dd data-testid="humanity">
              {v.humanity ? (
                <span className="badge ok">{v.humanity.level}</span>
              ) : (
                <span className="muted">not attested</span>
              )}
            </dd>
          </dl>

          <section className="v-block">
            <h3>Evidence</h3>
            <p className="row" data-testid="evidence">
              {evidence.map((e) => (
                <span key={e} className="badge">
                  {evidenceLabel(e)}
                </span>
              ))}
            </p>
          </section>
        </>
      )}
      <p className="warning" role="note">
        {v.warning}
      </p>
    </section>
  );
}
