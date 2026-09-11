import Link from "next/link";
import { WITHDRAWN } from "@ketsuban/registrar";
import type { Vouch } from "@/lib/api";
import { fmtUtc } from "./ui";

/**
 * The references written about one person.
 *
 * Shared by the candidate page and a person's own verification, because they were two renderings of
 * the same list and a reader arriving by either route is owed the same reading of it — including the
 * parts that are easy to leave out of one copy: that a reference was unsolicited, that it was
 * withdrawn, that a letter exists which nobody holds any more.
 */
export function VouchList({ vouches, handle }: { vouches: Vouch[]; handle: string }) {
  return (
    <>
      <h3>References received</h3>
      {vouches.length === 0 ? (
        <p>
          <em>none yet</em> — <a href={`/vouch/${handle}`}>be the first</a>
        </p>
      ) : (
        <>
          <ul className="vouches" data-testid="vouches">
            {vouches.map((v) => (
              <li
                key={`${v.voucher}-${v.nonce}`}
                className={v.live ? "live" : "expired"}
                data-testid={`vouch-${v.voucher}`}
              >
                <span className="vouch-who">
                  <Link href={`/p/${v.voucher}`}>
                    <code>{v.voucherName ?? v.voucher}</code>
                  </Link>
                  {/* Anyone may refer anyone; a reader is owed the difference between a reference the
                    subject asked for and one that simply arrived. */}
                  {!v.solicited && (
                    <span
                      className="badge badge-unsolicited"
                      title="no invitation from the subject came with this one"
                    >
                      unsolicited
                    </span>
                  )}
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
                {/* A letter too long for a record is kept off chain and named on chain by its hash. The
                  hash is the reason to believe the text; without it there is nothing to check. */}
                {v.letterHash && v.letter && (
                  <small className="muted" data-testid={`letter-hash-${v.voucher}`}>
                    letter checks against <code>sha256:{v.letterHash.slice(0, 12)}…</code> on the record
                  </small>
                )}
                {v.letterHash && !v.letter && (
                  <small className="warning" data-testid={`letter-gone-${v.voucher}`}>
                    a letter was written and cannot be shown: the record names{" "}
                    <code>sha256:{v.letterHash.slice(0, 12)}…</code>, but nobody holds a copy any more
                  </small>
                )}
                <span className="vouch-meta muted">
                  {v.live ? "live" : "expired"} · until {fmtUtc(v.validUntil)}
                  {/* The reference is a name of its own: read it anywhere, not only here. */}
                  {v.ensName && (
                    <>
                      {" · "}
                      <Link href={`/v/${v.ensName}`}>
                        <code>{v.ensName}</code>
                      </Link>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {/*
            Said in the page rather than in a tooltip, which a phone has no way to show.
            And said carefully: the badge is about the invitation, not about the subject. A candidate
            who asked with a link that turned out to be unsatisfiable gets references marked this way
            too, so reading it as "they did not ask" is reading more than the record says.
          */}
          {vouches.some((v) => !v.solicited) && (
            <p className="muted" data-testid="unsolicited-note">
              <strong>unsolicited</strong> means no invitation from {handle} came with that reference. Anyone
              may refer anyone here, so it is a fact about how the reference arrived — not a judgement of it,
              and not proof that {handle} never asked.
            </p>
          )}
        </>
      )}
    </>
  );
}
