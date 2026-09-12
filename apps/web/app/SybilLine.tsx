"use client";

import { useMemo } from "react";
import { useWebConfig } from "@/app/providers";
import { apiFor, useGraph, useReadings } from "@/lib/hooks";
import { HumanMark } from "@/app/HumanMark";

/**
 * The sybil signal, where the eye lands.
 *
 * Everything it says is computed further down the page — the shape behind the count, the trust that
 * reached them, how the references read — but a reader who came to size somebody up meets the name and
 * the ring first and rarely scrolls to the third card. So the whole of it is one line under the name:
 * trust, who stands behind them, whether those people know each other, how the words read. Numbers
 * beside a person are read as a verdict, and this is not one; the line says where each number comes
 * from, and the cards below say the rest.
 */
export function SybilLine({ handle }: { handle: string }) {
  const config = useWebConfig();
  const api = useMemo(() => apiFor(config), [config]);
  const graph = useGraph(api, handle);
  const readings = useReadings(api, handle);

  if (graph.isPending) {
    return (
      <p className="muted sybil-line" data-testid="sybil-line">
        sybil signal · reading the graph…
      </p>
    );
  }
  if (graph.isError || !graph.data) {
    return (
      <p className="muted sybil-line" data-testid="sybil-line">
        sybil signal · the graph could not be read just now
      </p>
    );
  }
  const g = graph.data;
  const me = handle.toLowerCase();
  const behind = g.edges.filter((e) => e.to === me).length;
  const r = readings.data;
  const read = r?.council ? r.summary.received : undefined;

  return (
    <p className="muted sybil-line" data-testid="sybil-line">
      <span title="what accumulated behind them, 0–100: proved humanity is a floor, every reference adds a share of its writer's score, and a ring nobody proved sums to nothing">
        SybilScore <strong data-testid="sybil-score">{g.score}</strong>
      </span>
      {" · "}
      {behind === 0 ? (
        <span>nobody behind them yet</span>
      ) : (
        <span title="references received, and how many of those people refer each other">
          <strong data-testid="sybil-behind">{behind}</strong> behind them,{" "}
          <strong data-testid="sybil-among">{g.metrics.referrersReferringEachOther}</strong> know each other
        </span>
      )}
      {" · "}
      <span data-testid="sybil-human">{g.human ? <HumanMark /> : "humanity not proved"}</span>
      {" · "}
      {read ? (
        <span data-testid="sybil-read" title="how the references read, by the fast council; provisional">
          reads {read.supportive} supportive / {read.critical} critical
        </span>
      ) : (
        <span data-testid="sybil-read" title="no council reads statements on this deployment">
          reads unread
        </span>
      )}
      {" · "}
      <a href="#who-stands-behind">details ↓</a>
    </p>
  );
}
