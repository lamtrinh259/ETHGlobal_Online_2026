/**
 * How hard this name would be to fake, as one number.
 *
 * Not a trust score and not an identity check: a high number says the account is expensive to
 * manufacture, not that the person is who they say. The two questions get confused constantly, so
 * every part carries the reason it counts and the page shows the parts rather than the number alone.
 *
 * What makes a sybil cheap is what the weights are drawn from. Accounts are cheap — one person opens
 * ten. References are cheap when they come from accounts as new as the one they vouch for, and
 * cheapest of all when two names refer each other, which costs one person two signatures. What is not
 * cheap is a proof of humanity, because a nullifier is spent once, and a reference from somebody who
 * has spent theirs.
 */
export type SybilInput = {
  /** Whether this wallet holds a live proof of humanity */
  human: boolean;
  /** One entry per distinct live referrer */
  referrers: {
    /** Whether the referrer holds a live proof of humanity of their own */
    human: boolean;
    /** Whether the subject has also referred them — a mutual pair costs one person two signatures */
    mutual: boolean;
  }[];
  /** Distinct platform accounts attested to this name */
  accounts: number;
};

export type SybilPart = {
  id: "humanity" | "vouched-by-humans" | "independence" | "accounts";
  label: string;
  /** What this part is worth out of 100 */
  weight: number;
  earned: number;
  /** Why this part resists a sybil, in one line */
  why: string;
  detail: string;
};

/** Beyond this, more referrers say nothing new: it is the point where farming them starts. */
export const HUMAN_REFERRER_FLOOR = 3;
/** Same reasoning for accounts, which are cheaper still. */
export const ACCOUNT_FLOOR = 3;

/** A band, so a reader is not left to decide what 61 means. */
export function sybilBand(score: number): "strong" | "moderate" | "weak" {
  if (score >= 70) return "strong";
  if (score >= 35) return "moderate";
  return "weak";
}

export function sybilScore(input: SybilInput): { score: number; band: string; parts: SybilPart[] } {
  const total = input.referrers.length;
  const humans = input.referrers.filter((r) => r.human).length;
  const counted = Math.min(humans, HUMAN_REFERRER_FLOOR);
  const mutual = input.referrers.filter((r) => r.mutual).length;
  const accounts = Math.min(input.accounts, ACCOUNT_FLOOR);

  const parts: SybilPart[] = [
    {
      id: "humanity",
      label: "Proof of humanity",
      weight: 30,
      earned: input.human ? 30 : 0,
      why: "A nullifier is spent once, so one person cannot hold two of these.",
      detail: input.human ? "proved" : "not proved",
    },
    {
      id: "vouched-by-humans",
      label: "Referred by proven humans",
      weight: 30,
      earned: Math.round((30 * counted) / HUMAN_REFERRER_FLOOR),
      why: "Each one costs a separate person's proof, which cannot be bought in bulk.",
      detail: `${humans} of ${total || 0} referrer${total === 1 ? "" : "s"} proved`,
    },
    {
      id: "independence",
      // No referrers is not independence; it is nothing to be independent of.
      label: "Independent references",
      weight: 25,
      earned: total === 0 ? 0 : Math.round((25 * (total - mutual)) / total),
      why: "Two names referring each other is the cheapest fake there is: one person, two signatures.",
      detail:
        total === 0
          ? "no references yet"
          : mutual === 0
            ? "none are mutual"
            : `${mutual} of ${total} are mutual`,
    },
    {
      id: "accounts",
      label: "Accounts attested",
      weight: 15,
      earned: Math.round((15 * accounts) / ACCOUNT_FLOOR),
      why: "Weakest of the four: one person can open several, which is why it is worth the least.",
      detail: `${input.accounts} attested`,
    },
  ];
  const score = parts.reduce((n, p) => n + p.earned, 0);
  return { score, band: sybilBand(score), parts };
}
