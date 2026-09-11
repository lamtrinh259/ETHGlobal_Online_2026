"use client";

import { PlatformIcon } from "@/app/PlatformIcon";
import { whyUnsatisfiable } from "@/lib/invite";

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
  parentNames = [],
}: {
  candidate: string;
  requires: readonly string[];
  /** Domains this writer holds live records in */
  attested: readonly string[];
  /** The deployment's own name parents, for telling a domain from a name it answers for */
  parentNames?: readonly string[];
}) {
  if (requires.length === 0) return null;
  const held = new Set(attested.map((d) => d.toLowerCase()));
  /*
   * A requirement that is not a domain can never be held by anybody.
   *
   * The attester looks for a record the writer holds in each named domain, so a username or a name in
   * this deployment has nothing to match. Shown as an ordinary unmet row it reads as one more account
   * to go and link, and the writer spends their time on something that cannot change the outcome.
   * Invitations like this can no longer be made, but the ones already signed are out there.
   */
  const impossible = new Map(
    requires.map((d) => [d, whyUnsatisfiable(d, parentNames)] as const).filter(([, why]) => why)
  );
  const met = requires.every((d) => held.has(d.toLowerCase()));

  return (
    <div className={met ? "muted" : "warning"} data-testid="invite-terms">
      <p>
        {candidate} asked for a reference from someone with{" "}
        {met ? "these accounts, which you have attested." : "these accounts."}
        {!met && " You can still write one; it will be marked unsolicited."}
      </p>
      {impossible.size > 0 && (
        <p data-testid="invite-impossible">
          This invitation cannot be satisfied by anyone, however many accounts you link:{" "}
          {[...impossible.values()].join(" ")} Write the reference if you mean to — it is published either way
          — and ask {candidate} for a new link if you want it to count as one they asked for.
        </p>
      )}
      <ul className="acct">
        {requires.map((d) => (
          <li
            key={d}
            className={impossible.has(d) ? "todo" : held.has(d.toLowerCase()) ? "done" : "todo"}
            data-testid={`term-${d}`}
          >
            <PlatformIcon domain={d} size={16} />
            <span className="acct-id">
              <strong>{d}</strong>
            </span>
            <span className="acct-state">
              {impossible.has(d)
                ? "cannot be attested"
                : held.has(d.toLowerCase())
                  ? "attested"
                  : "not attested"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
