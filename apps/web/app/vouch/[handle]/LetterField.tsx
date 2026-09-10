"use client";

import { Hint } from "@/app/Hint";
import { LETTER_MAX } from "@/lib/chain";

/** How many bytes a letter takes, which is what decides whether it fits on the record. */
export const letterBytes = (text: string) => new TextEncoder().encode(text).length;

/**
 * The body of a reference.
 *
 * Shared by the form that writes one with the record and the form that replaces one later, because
 * the thing worth explaining — that a short letter lives on chain and a long one is kept by its hash —
 * is easy to say in one place and easy to say two different ways in two.
 */
export function LetterField({
  value,
  onChange,
  candidate,
  label = "Letter",
}: {
  value: string;
  onChange: (next: string) => void;
  candidate: string;
  label?: string;
}) {
  const bytes = letterBytes(value);
  const byHash = bytes > LETTER_MAX;
  return (
    <label>
      {label}{" "}
      <Hint
        text={`Kept off chain and named on chain by its hash, so anyone can check a copy they are given against the record. Under ${LETTER_MAX} bytes it goes on chain whole.`}
      />
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={5}
        placeholder={`How you know ${candidate}, over what period, and what you would tell someone who asked.`}
        aria-label="letter"
      />
      <small className="muted" data-testid="letter-count">
        {bytes} bytes · {byHash ? "kept by its hash" : "goes on chain whole"}
      </small>
    </label>
  );
}
