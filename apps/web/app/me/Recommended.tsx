"use client";

import { askById } from "@/lib/asks";
import { questionTitle } from "@/lib/questions";

export type AnswerRow = { domain: string; ensName: string; answer: string };

/**
 * Questions this deployment asks its own candidates.
 *
 * An answer is a claim you make about yourself, published under your own name — which is what makes it
 * different from a reference, and why answering one must never ask whose account you mean.
 */
export function Recommended({ rows, onAnswer }: { rows: AnswerRow[]; onAnswer: (domain: string) => void }) {
  if (rows.length === 0) return null;
  return (
    <ul className="acct" data-testid="answers">
      {rows.map((r) => (
        <li key={r.domain} data-testid={`answer-${r.domain}`}>
          <span className="acct-id">
            {/* The question, not the domain it lives in: nobody outside this repo knows `kju-is`. */}
            <strong>{questionTitle(r.domain)}</strong>
            <small className="muted">
              {r.answer ? `“${r.answer}”` : (askById(r.domain)?.why ?? "not answered")}
            </small>
          </span>
          <span className="acct-state">
            <button onClick={() => onAnswer(r.domain)} data-testid={`answer-now-${r.domain}`}>
              {r.answer ? "Change" : "Answer"}
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}
