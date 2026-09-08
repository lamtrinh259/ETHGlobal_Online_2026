import type { Verification } from "@/lib/api";
import { fmtUtc } from "./ui";

/** Public verification view: exactly what any ENS client would read, with the warning always visible. */
export function VerifyCard({ v }: { v: Verification }) {
  const active = v.status === "active";
  return (
    <section aria-label="verification" className="card">
      <h2>{v.name}</h2>
      <p className="row">
        <span className={`badge ${active ? "ok" : "off"}`} data-testid="status">
          {active ? "active" : "no record"}
        </span>
        <small className="muted">
          instance <code>{v.instance.domain}</code> under <code>{v.instance.parentName}</code>
        </small>
      </p>
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
