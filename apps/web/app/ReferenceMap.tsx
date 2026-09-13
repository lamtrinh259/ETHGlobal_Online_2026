"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useWebConfig } from "@/app/providers";
import { apiFor, useGraph } from "@/lib/hooks";
import { HumanMark } from "@/app/HumanMark";

/**
 * The shape behind the count.
 *
 * Three references from three strangers and three from a ring of accounts that only refer each other
 * are the same number on the ring above. This is what tells them apart: the person in the middle, the
 * people who stand behind them around the edge, and a line for every reference among that set. When
 * the referrers refer each other the lines close into a shape; when they are strangers they do not.
 *
 * Every line is a signed record anybody can resolve. The rank beside it is a signal, not a verdict —
 * trust that spread from whoever proved humanity, and did or did not reach this person — and it
 * carries the same caveat as everything else here: a newcomer with one honest reference and a fake
 * with one bought one look alike until more people speak.
 */
export function ReferenceMap({ handle }: { handle: string }) {
  const config = useWebConfig();
  const api = useMemo(() => apiFor(config), [config]);
  const graph = useGraph(api, handle);

  if (graph.isPending) {
    return (
      <section className="card refmap" id="who-stands-behind" data-testid="reference-map">
        <h3>Who stands behind them</h3>
        <p className="muted">reading the graph…</p>
      </section>
    );
  }
  if (graph.isError || !graph.data) {
    return (
      <section className="card refmap" id="who-stands-behind" data-testid="reference-map">
        <h3>Who stands behind them</h3>
        <p className="warning" data-testid="reference-map-unread">
          The graph could not be read just now, which says nothing about this person.
        </p>
      </section>
    );
  }

  const g = graph.data;
  const me = handle.toLowerCase();
  const others = g.nodes.filter((n) => n.handle !== me);
  // A ring of the others around the centre. Geometry, not meaning: position says nothing.
  const R = 88;
  const at = new Map<string, { x: number; y: number }>([[me, { x: 0, y: 0 }]]);
  others.forEach((n, i) => {
    const a = (i / Math.max(1, others.length)) * Math.PI * 2 - Math.PI / 2;
    at.set(n.handle, { x: Math.cos(a) * R, y: Math.sin(a) * R });
  });
  const referrers = g.edges.filter((e) => e.to === me).length;
  const m = g.metrics;

  return (
    <section className="card refmap" id="who-stands-behind" data-testid="reference-map">
      <h3>Who stands behind them</h3>
      {referrers === 0 ? (
        <p className="muted" data-testid="reference-map-empty">
          Nobody yet, so there is no shape to read.
        </p>
      ) : (
        <>
          {/*
            One line a reader can take in, before any picture.
            A graph is hard to read and harder to read in four minutes; the numbers it is drawn from
            are not. So the shape is said first, plainly, and the drawing waits behind a fold for the
            reader who wants to see it.
          */}
          <p data-testid="shape-summary">
            SybilScore <strong data-testid="shape-score">{g.score}</strong> · <strong>{referrers}</strong>{" "}
            {referrers === 1 ? "person stands" : "people stand"} behind them ·{" "}
            <strong>{m.referrersReferringEachOther}</strong> of those know each other ·{" "}
            {g.seeds === 0 ? (
              <span className="muted">no proved human to measure trust from yet</span>
            ) : (
              <>
                trust <strong>{g.rank.toFixed(3)}</strong> from {g.seeds} proved{" "}
                {g.seeds === 1 ? "human" : "humans"}
                {g.human && (
                  <>
                    , <HumanMark />
                  </>
                )}
              </>
            )}
          </p>
          <details className="refmap-fold" data-testid="refmap-fold">
            <summary className="muted">Show the map</summary>
            <div className="refmap-row">
              <svg
                viewBox="-130 -130 260 260"
                className="refmap-svg"
                role="img"
                aria-label={`vouches around ${handle}`}
              >
                {g.edges.map((e) => {
                  const a = at.get(e.from);
                  const b = at.get(e.to);
                  if (!a || !b) return null;
                  const mine = e.to === me || e.from === me;
                  /*
                   * A reference among the referrers bows outward.
                   * Two referrers sit opposite each other, and a straight line between them runs through
                   * the person in the middle — reading as two references to them rather than one between
                   * the pair. Bowed away from the centre it reads as what it is.
                   */
                  const mx = (a.x + b.x) / 2;
                  const my = (a.y + b.y) / 2;
                  const len = Math.hypot(mx, my);
                  /*
                   * Neighbours on the ring bow outward, past the ring. A pair sitting opposite each other
                   * has no outward — their midpoint is the centre — so they bow sideways instead, each
                   * direction of the pair to its own side, which keeps the two from lying on one arc.
                   */
                  const bow = R * 1.3;
                  const across = len < R * 0.25;
                  const px = (a.y - b.y) / (Math.hypot(a.x - b.x, a.y - b.y) || 1);
                  const py = (b.x - a.x) / (Math.hypot(a.x - b.x, a.y - b.y) || 1);
                  const cx = mine ? mx : across ? px * R * 0.55 : (mx / len) * bow;
                  const cy = mine ? my : across ? py * R * 0.55 : (my / len) * bow;
                  return (
                    <path
                      key={`${e.from}>${e.to}`}
                      d={mine ? `M${a.x} ${a.y} L${b.x} ${b.y}` : `M${a.x} ${a.y} Q${cx} ${cy} ${b.x} ${b.y}`}
                      fill="none"
                      className={mine ? "refmap-edge" : "refmap-edge refmap-among"}
                      data-testid={`edge-${e.from}-${e.to}`}
                    />
                  );
                })}
                {g.nodes.map((n) => {
                  const p = at.get(n.handle)!;
                  return (
                    <g key={n.handle} transform={`translate(${p.x} ${p.y})`} data-testid={`node-${n.handle}`}>
                      <circle
                        r={n.handle === me ? 14 : 10}
                        className={n.human ? "refmap-node refmap-human" : "refmap-node"}
                      />
                      <text y={n.handle === me ? 28 : 22} textAnchor="middle" className="refmap-label">
                        {n.handle}
                      </text>
                    </g>
                  );
                })}
              </svg>
              <dl className="refmap-facts" data-testid="reference-facts">
                <div>
                  <dt>Referrers who refer each other</dt>
                  <dd data-testid="fact-among">
                    {m.referrersReferringEachOther} of {referrers}
                  </dd>
                </div>
                <div>
                  <dt>Vouches returned</dt>
                  <dd data-testid="fact-mutual">
                    {m.mutual} of {referrers}
                  </dd>
                </div>
                <div>
                  <dt>People reachable from here</dt>
                  <dd data-testid="fact-cluster">{m.clusterSize}</dd>
                </div>
                <div>
                  <dt>Trust that reached them</dt>
                  <dd data-testid="fact-rank">
                    {g.seeds === 0 ? (
                      <span className="muted">
                        nobody has proved humanity yet, so trust has nowhere to start
                      </span>
                    ) : (
                      <>
                        {g.rank.toFixed(3)}{" "}
                        <small className="muted">
                          from {g.seeds} proved {g.seeds === 1 ? "human" : "humans"}
                          {g.human ? ", one of them" : ""}
                        </small>
                      </>
                    )}
                  </dd>
                </div>
              </dl>
            </div>
          </details>
        </>
      )}
      <p className="muted refmap-caveat">
        Every line is a signed record anyone can resolve. The rank is a signal, not a verdict: a newcomer with
        one honest vouch and a ring with one bought one look alike until more people speak.{" "}
        <Link href="/trust">How this is computed →</Link>
      </p>
    </section>
  );
}
