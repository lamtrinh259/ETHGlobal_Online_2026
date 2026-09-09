import Link from "next/link";
import { WITHDRAWN } from "@ketsuban/registrar";
import { describePolicy, type Policy, type Profile } from "@/lib/profile";
import { fmtUtc } from "./ui";

/** The candidate reference page: identity, answers, links, humanity, and the policy checks. */
export function ProfileCard({ p, rootParent, policy }: { p: Profile; rootParent: string; policy?: Policy }) {
  return (
    <section className="card" aria-label="candidate page">
      <h2>
        {p.handle}.{rootParent}
      </h2>
      <p className="row">
        <span className={`badge ${p.complete ? "ok" : "off"}`} data-testid="completeness">
          {p.complete ? "complete" : "incomplete"}
        </span>
        <small className="muted">
          {p.identity && p.wallet ? (
            <>
              wallet <Link href={`/w/${p.wallet}`}>{p.wallet}</Link>
            </>
          ) : (
            "unclaimed"
          )}
        </small>
      </p>

      {p.identity?.profile &&
        (p.identity.profile.description || p.identity.profile.url || p.identity.profile.avatar) && (
          <div className="ens-profile" data-testid="ens-profile">
            {p.identity.profile.avatar && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.identity.profile.avatar} alt="" className="ens-avatar" width={48} height={48} />
            )}
            <div>
              {p.identity.profile.description && <p>{p.identity.profile.description}</p>}
              {p.identity.profile.url && (
                <a href={p.identity.profile.url} rel="noreferrer nofollow">
                  {p.identity.profile.url}
                </a>
              )}
            </div>
          </div>
        )}

      {!p.identity && p.vouches.some((v) => v.live) && (
        <p className="warning" data-testid="waiting">
          Nobody holds this name yet, and {p.vouches.filter((v) => v.live).length} reference
          {p.vouches.filter((v) => v.live).length === 1 ? " is" : "s are"} already written for it. If this is
          you, <Link href="/me">claim the name</Link> and they attach to it — an organisation can write a
          letter before the person has heard of us.
        </p>
      )}

      {policy && (
        <p className="muted" data-testid="policy-line">
          Policy: {describePolicy(policy)}
        </p>
      )}
      <ul className="checks" data-testid="checks">
        {p.checks.map((c) => (
          <li key={c.id} className={c.ok ? "ok" : "no"}>
            <span className="check-mark" aria-hidden>
              {c.ok ? "✓" : "✗"}
            </span>
            <span className="check-label">{c.label}</span>
            <span className="check-detail muted">{c.detail}</span>
          </li>
        ))}
      </ul>

      {p.answers.length > 0 && (
        <>
          <h3>Answers</h3>
          <dl className="kv" data-testid="answers">
            {p.answers.map((a) => (
              <div key={a.domain} className="kv-row">
                <dt>
                  <code>{a.name}</code>
                </dt>
                <dd>
                  {a.status === "active" && a.answer ? (
                    <>
                      “{a.answer}” <small className="muted">valid until {fmtUtc(a.expiresAt)}</small>
                    </>
                  ) : (
                    <em>not answered</em>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}

      <h3>Linked accounts</h3>
      {p.links.length === 0 ? (
        <p>
          <em>none</em>
        </p>
      ) : (
        <ul data-testid="links">
          {p.links.map((l) => (
            <li key={l.domain}>
              <code>{l.domain}</code>{" "}
              {l.disclosed ? (
                <>
                  @{l.disclosed.handle}{" "}
                  <span className="badge ok" data-testid="disclosed">
                    disclosed to you by the candidate
                  </span>
                </>
              ) : l.optedIn ? (
                "verified, masked — needs a view code"
              ) : (
                "verified"
              )}
            </li>
          ))}
        </ul>
      )}

      <h3>Vouches</h3>
      {p.vouches.length === 0 ? (
        <p>
          <em>none yet</em> — <a href={`/vouch/${p.handle}`}>be the first</a>
        </p>
      ) : (
        <ul className="vouches" data-testid="vouches">
          {p.vouches.map((v) => (
            <li key={`${v.voucher}-${v.nonce}`} className={v.live ? "live" : "expired"}>
              <span className="vouch-who">
                <Link href={`/p/${v.voucher}`}>
                  <code>{v.voucherName ?? v.voucher}</code>
                </Link>
                {v.standing && (
                  <small className="muted" data-testid="standing">
                    {" "}
                    · {v.standing.claimed ? "" : "unclaimed · "}gave {v.standing.given} · received{" "}
                    {v.standing.received}
                  </small>
                )}
              </span>
              {v.statement === WITHDRAWN ? (
                <span className="vouch-what vouch-withdrawn" data-testid="withdrawn">
                  withdrawn by the voucher
                </span>
              ) : (
                <span className="vouch-what">“{v.statement}”</span>
              )}
              {v.letter && (
                <span className="vouch-letter" data-testid="vouch-letter">
                  {v.letter}
                </span>
              )}
              <span className="vouch-meta muted">
                {v.live ? "live" : "expired"} · until {fmtUtc(v.validUntil)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <h3>Humanity</h3>
      <p data-testid="humanity">{p.humanity ? `attested (${p.humanity.level})` : "not attested"}</p>

      <p className="warning" role="note">
        {p.warning}
      </p>
    </section>
  );
}
