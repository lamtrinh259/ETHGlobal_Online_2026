"use client";

import { PlatformIcon } from "@/app/PlatformIcon";

/**
 * What the candidate asked the writer to show, and whether they show it.
 *
 * An unmet requirement is a fact about the reference, never a wall: anyone may refer anyone. Saying
 * nothing would let someone publish and then wonder why it came out unsolicited.
 */
export function InviteTerms({
  candidate,
  requires,
  attested,
}: {
  candidate: string;
  requires: readonly string[];
  /** Domains this writer holds live records in */
  attested: readonly string[];
}) {
  if (requires.length === 0) return null;
  const held = new Set(attested.map((d) => d.toLowerCase()));
  const met = requires.every((d) => held.has(d.toLowerCase()));

  return (
    <div className={met ? "muted" : "warning"} data-testid="invite-terms">
      <p>
        {candidate} asked for a reference from someone with{" "}
        {met ? "these accounts, which you have attested." : "these accounts."}
        {!met && " You can still write one; it will be marked unsolicited."}
      </p>
      <ul className="acct">
        {requires.map((d) => (
          <li key={d} className={held.has(d.toLowerCase()) ? "done" : "todo"} data-testid={`term-${d}`}>
            <PlatformIcon domain={d} size={16} />
            <span className="acct-id">
              <strong>{d}</strong>
            </span>
            <span className="acct-state">{held.has(d.toLowerCase()) ? "attested" : "not attested"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
