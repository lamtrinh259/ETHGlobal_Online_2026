"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useWebConfig } from "@/app/providers";
import { apiFor, useReadings } from "@/lib/hooks";
import { LeanChip, signed } from "@/app/LeanChip";

/**
 * What the references say, in one line.
 *
 * A count and a shape still leave the reader with sentences to read, and a verifier with forty pages
 * to get through will not read them. So each statement is read once by the Noolog fast council and
 * the readings are summed into one line — how many read as supportive, how many as critical — with
 * every reading behind a fold for whoever wants to check the line against the words.
 *
 * It is a reading of text, not a judgement of a person, and it says so: provisional, by which council,
 * superseded when peers have judged. Where no council is configured the statements are shown as
 * written, and nothing here pretends to have read them.
 */
function Line({
  s,
  side,
}: {
  s: { of: number; read: number; mean: number | null; supportive: number; critical: number };
  side: "received" | "given";
}) {
  const unread = s.of - s.read;
  return (
    <p data-testid={`readings-${side}`}>
      <strong>{s.supportive}</strong> of {s.read} read as supportive · <strong>{s.critical}</strong> critical
      {s.mean !== null && (
        <>
          {" "}
          · mean <strong>{signed(s.mean)}</strong>
        </>
      )}
      {unread > 0 && <span className="muted"> · {unread} unread</span>}
    </p>
  );
}

export function Readings({ handle }: { handle: string }) {
  const config = useWebConfig();
  const api = useMemo(() => apiFor(config), [config]);
  const q = useReadings(api, handle);

  if (q.isPending) {
    return (
      <section className="card readings" data-testid="readings">
        <h3>What the references say</h3>
        <p className="muted">reading…</p>
      </section>
    );
  }
  if (q.isError || !q.data) {
    return (
      <section className="card readings" data-testid="readings">
        <h3>What the references say</h3>
        <p className="warning" data-testid="readings-unread">
          The readings could not be fetched just now, which says nothing about this person.
        </p>
      </section>
    );
  }

  const r = q.data;
  return (
    <section className="card readings" data-testid="readings">
      <h3>What the references say</h3>
      {r.received.length === 0 && r.given.length === 0 ? (
        <p className="muted" data-testid="readings-empty">
          Nothing written for them or by them yet, so there is nothing to read.
        </p>
      ) : !r.council ? (
        <p className="muted" data-testid="readings-no-council">
          {r.received.length} written for them and {r.given.length} by them, shown as written: no council
          reads statements on this deployment.
        </p>
      ) : (
        <>
          {r.received.length > 0 ? (
            <Line s={r.summary.received} side="received" />
          ) : (
            <p className="muted" data-testid="readings-received">
              Nothing written for them yet.
            </p>
          )}
          <p className="muted">
            <small>provisional — how {r.model} read each statement, superseded when peers have judged</small>
          </p>
        </>
      )}
      {(r.received.length > 0 || r.given.length > 0) && (
        <details className="readings-fold" data-testid="readings-fold">
          <summary className="muted">Show each reading</summary>
          {r.received.length > 0 && (
            <>
              <h4>Written for them</h4>
              <ul className="readings-list" data-testid="readings-received-list">
                {r.received.map((x) => (
                  <li key={x.voucher} data-testid={`reading-${x.voucher}`}>
                    <Link href={`/p/${x.voucher}`}>
                      <code>{x.voucher}</code>
                    </Link>{" "}
                    <span className="vouch-what">“{x.says}”</span>{" "}
                    <LeanChip reading={x.reading} id={x.voucher} />
                    {x.reading?.rationale && <small className="muted"> — {x.reading.rationale}</small>}
                  </li>
                ))}
              </ul>
            </>
          )}
          {r.given.length > 0 && (
            <>
              <h4>Written by them</h4>
              {r.council && <Line s={r.summary.given} side="given" />}
              <ul className="readings-list" data-testid="readings-given-list">
                {r.given.map((x) => (
                  <li key={x.candidate} data-testid={`reading-given-${x.candidate}`}>
                    about{" "}
                    <Link href={`/p/${x.candidate}`}>
                      <code>{x.candidate}</code>
                    </Link>{" "}
                    <span className="vouch-what">“{x.says}”</span>{" "}
                    <LeanChip reading={x.reading} id={`given-${x.candidate}`} />
                    {x.reading?.rationale && <small className="muted"> — {x.reading.rationale}</small>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </details>
      )}
      <p className="muted readings-caveat">
        A reading is how a council of models read thirty-one bytes of text, not a judgement of a person. The
        words are the record; the reading is a way in. <Link href="/trust">How statements are read →</Link>
      </p>
    </section>
  );
}
