import type { Sybil } from "@/lib/api";

/**
 * How hard a name would be to fake, with its parts shown.
 *
 * The number alone would be read as a trust rating, which it is not: it says what the account cost to
 * build, not who holds it. So the parts are not a disclosure hidden behind a toggle — they are the
 * content, and the number is the summary of them.
 */
export function SybilScore({ s }: { s: Sybil }) {
  return (
    <section className="card" aria-label="sybil resistance" data-testid="sybil">
      <h3>How hard this is to fake</h3>
      <p className="row">
        <strong className={`sybil-score sybil-${s.band}`} data-testid="sybil-score">
          {s.score}
          <small>/100</small>
        </strong>
        <span className={`badge sybil-${s.band}`} data-testid="sybil-band">
          {s.band}
        </span>
      </p>
      <ul className="sybil-parts" data-testid="sybil-parts">
        {s.parts.map((p) => (
          <li key={p.id} data-testid={`sybil-${p.id}`} className={p.earned === 0 ? "empty" : ""}>
            <span className="sybil-part-head">
              <strong>{p.label}</strong>
              <small className="muted">
                {p.earned} / {p.weight}
              </small>
            </span>
            {/* A bar is the only part of this that can be read at a glance; the words carry the rest. */}
            <span className="sybil-bar" aria-hidden>
              <span style={{ width: `${Math.round((p.earned / p.weight) * 100)}%` }} />
            </span>
            <small className="sybil-detail">{p.detail}</small>
            <small className="muted sybil-why">{p.why}</small>
          </li>
        ))}
      </ul>
      <p className="warning" role="note">
        {s.warning}
      </p>
    </section>
  );
}
