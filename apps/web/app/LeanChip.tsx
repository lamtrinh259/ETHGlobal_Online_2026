import type { Reading } from "@/lib/api";

/**
 * Which way a statement reads: the fast council's provisional polarity, as a badge.
 *
 * Three kinds and no more — supportive, neutral, critical — because a number a reader has to interpret
 * beside every reference is a number they skip. The number is still there, for whoever wants it.
 */
export function lean(polarity: number): "supportive" | "critical" | "neutral" {
  if (polarity > 0.2) return "supportive";
  if (polarity < -0.2) return "critical";
  return "neutral";
}

export const signed = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(2)}`;

// Written out, so the stylesheet's own check can see each class is used.
const CLASS = {
  supportive: "reading reading-supportive",
  critical: "reading reading-critical",
  neutral: "reading reading-neutral",
} as const;

export function LeanChip({ reading, id }: { reading: Reading | null | undefined; id: string }) {
  if (reading === undefined) return null;
  if (reading === null) {
    return (
      <span className="reading reading-unread" data-testid={`lean-${id}`}>
        unread
      </span>
    );
  }
  const l = lean(reading.polarity);
  return (
    <span className={CLASS[l]} data-testid={`lean-${id}`} title={reading.rationale}>
      {signed(reading.polarity)} {l}
    </span>
  );
}
