import type { Verification } from "@/lib/api";
import { ProfileHead } from "./ProfileHead";
import { fmtUtc } from "./ui";

/** Public verification view: exactly what any ENS client would read, with the warning always visible. */
export function VerifyCard({ v }: { v: Verification }) {
  const active = v.status === "active";
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
        <dl className="kv">
          <dt>wallet</dt>
          <dd>
            <code>{v.wallet}</code>
          </dd>
          <dt>answer</dt>
          <dd data-testid="answer">{v.answer || <em>none</em>}</dd>
          <dt>expires</dt>
          <dd>{fmtUtc(v.expiresAt)}</dd>
          <dt>humanity</dt>
          <dd data-testid="humanity">{v.humanity ? v.humanity.level : "not attested"}</dd>
          <dt>linked accounts</dt>
          <dd>
            {v.links.length === 0 ? (
              <em>none</em>
            ) : (
              <ul data-testid="links">
                {v.links.map((l) => (
                  <li key={l.domain}>
                    <code>{l.domain}</code>{" "}
                    {l.disclosed
                      ? `@${l.disclosed.handle} (id ${l.disclosed.platformId})`
                      : l.optedIn
                        ? "verified, masked — needs a view code"
                        : "verified"}
                    {/* Read it back yourself: the name resolves for anyone, this page is not the source. */}
                    {l.ensName && (
                      <>
                        {" · "}
                        <code>{l.ensName}</code>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </dd>
          <dt>evidence</dt>
          <dd>
            <code>{v.evidence.join(", ")}</code>
          </dd>
        </dl>
      )}
      <p className="warning" role="note">
        {v.warning}
      </p>
    </section>
  );
}
