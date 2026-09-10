/**
 * How far a profile has got, as one number.
 *
 * The parts are weighted by what a verifier actually asks for rather than by effort: a name and
 * references are most of the score, because they are what anyone else can check.
 *
 * Humanity is deliberately not in here. This measures how far a profile has got, which is the holder's
 * own business; how hard the account would be to fake is a different question, asked of it by somebody
 * else, and answered by the sybil score instead.
 */
export type ScoreInput = {
  hasName: boolean;
  accounts: number;
  profile: { avatar: string; description: string; url: string };
  references: number;
};

export type ScorePart = {
  id: "name" | "accounts" | "profile" | "references";
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
      weight: 40,
      earned: Math.round((40 * references) / REFERENCE_FLOOR),
      done: references >= REFERENCE_FLOOR,
      hint: `${input.references} of ${REFERENCE_FLOOR}`,
    },
    {
      id: "name",
      label: "Name",
      weight: 25,
      earned: input.hasName ? 25 : 0,
      done: input.hasName,
      hint: input.hasName ? "claimed" : "not claimed",
    },
    {
      id: "accounts",
      label: "Accounts",
      weight: 20,
      earned: accounts * 10,
      done: accounts >= 2,
      hint: `${input.accounts} attested`,
    },
    {
      id: "profile",
      label: "Profile",
      weight: 15,
      earned: fields * 5,
      done: fields >= 3,
      hint: `${fields} of 3 filled`,
    },
  ];
  return { score: parts.reduce((n, p) => n + p.earned, 0), parts };
}
