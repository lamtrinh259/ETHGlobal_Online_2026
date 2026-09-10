"use client";

import Link from "next/link";
import { askById } from "@/lib/asks";
import { fmtUtc } from "@/app/ui";
import { questionTitle } from "@/lib/questions";

export type AnswerRow = {
  domain: string;
  ensName: string;
  answer: string;
  /** When the record lapses; an answer with no date reads as permanent and is not */
  validUntil: string | null;
};

/** The question's own name: `alice.kju-is.ketsuban.eth` is answered under `kju-is.ketsuban.eth`. */
const instanceName = (ensName: string) => ensName.split(".").slice(1).join(".");

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
              {r.answer && r.validUntil ? ` · until ${fmtUtc(r.validUntil)}` : ""}
            </small>
            {/* The instance name publishes what answering the question is for, readable without us. */}
            <small className="muted">
              <Link href={`/v/${instanceName(r.ensName)}`} data-testid={`about-${r.domain}`}>
                {instanceName(r.ensName)}
              </Link>
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
