/**
 * How far a profile has got, as one number.
 *
 * The parts are weighted by what a verifier actually asks for rather than by effort: a name and
 * references are most of the score, because they are what anyone else can check.
 *
 * Proof of humanity is the heaviest single part, because it is the only one that cannot be produced
 * twice by the same person: a nullifier is spent once. Everything else here can be manufactured in
 * bulk by somebody determined, which is what the weights are saying.
 */
export type ScoreInput = {
  /** Whether this wallet holds a live proof of humanity */
  human: boolean;
  hasName: boolean;
  accounts: number;
  profile: { avatar: string; description: string; url: string };
  references: number;
};

export type ScorePart = {
  id: "humanity" | "name" | "accounts" | "profile" | "references";
  label: string;
  /** What this part is worth out of 100 */
  weight: number;
  /** What it has earned so far */
  earned: number;
  done: boolean;
  hint: string;
};

/** References a verifier usually asks for; more than this adds nothing, so nobody farms the number. */
export const REFERENCE_FLOOR = 3;

export function profileScore(input: ScoreInput): { score: number; parts: ScorePart[] } {
  const fields = [input.profile.avatar, input.profile.description, input.profile.url].filter(
    (v) => v.trim() !== ""
  ).length;
  const accounts = Math.min(input.accounts, 2);
  const references = Math.min(input.references, REFERENCE_FLOOR);

  const parts: ScorePart[] = [
    {
      id: "references",
      label: "References",
      weight: 30,
      earned: Math.round((30 * references) / REFERENCE_FLOOR),
      done: references >= REFERENCE_FLOOR,
      hint: `${input.references} of ${REFERENCE_FLOOR}`,
    },
    {
      id: "humanity",
      label: "Humanity",
      weight: 25,
      earned: input.human ? 25 : 0,
      done: input.human,
      // The only part nobody can hold twice, which is why it weighs as much as a claimed name.
      hint: input.human ? "proved" : "not proved",
    },
    {
      id: "name",
      label: "Name",
      weight: 20,
      earned: input.hasName ? 20 : 0,
      done: input.hasName,
      hint: input.hasName ? "claimed" : "not claimed",
    },
    {
      id: "accounts",
      label: "Accounts",
      weight: 15,
      earned: accounts * 7.5,
      done: accounts >= 2,
      hint: `${input.accounts} attested`,
    },
    {
      id: "profile",
      label: "Profile",
      weight: 10,
      earned: Math.round((10 * fields) / 3),
      done: fields >= 3,
      hint: `${fields} of 3 filled`,
    },
  ];
  return { score: Math.round(parts.reduce((n, p) => n + p.earned, 0)), parts };
}
