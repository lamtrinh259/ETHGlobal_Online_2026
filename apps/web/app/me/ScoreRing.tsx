import type { ScorePart } from "@/lib/score";

/** Where each part is fixed. A name and the profile it resolves to are one step, so they share one. */
const STEPS: Record<ScorePart["id"], string> = {
  references: "references",
  humanity: "humanity",
  name: "name",
  accounts: "accounts",
  profile: "name",
};

const ICONS: Record<ScorePart["id"], string> = {
  references: "✍",
  humanity: "☝",
  name: "◈",
  accounts: "⛓",
  profile: "☺",
};

/**
 * How far the profile has got, at the top of the page. The parts are shown beside the number so it is
 * never only a verdict: whatever is missing is the next thing to do, and says how much it is worth.
 */
export function ScoreRing({
  score,
  parts,
  mine = false,
}: {
  score: number;
  parts: ScorePart[];
  /** Your own page, where each part is a step you can take */
  mine?: boolean;
}) {
  return (
    <section className="card score-card">
      <div
        className="score-ring"
        data-testid="score"
        role="img"
        aria-label={`Profile ${score} of 100`}
        style={{ ["--pct" as string]: `${score}` }}
      >
        <strong>{score}</strong>
        <small>/100</small>
      </div>
      <ul className="score-parts">
        {parts.map((p) => (
          <li key={p.id} className={p.done ? "done" : "todo"} data-testid={`part-${p.id}`}>
            <span aria-hidden>{ICONS[p.id]}</span>
            {/* On your own page every part is the next thing to do, so it links to the step that does
                it. On somebody else's it is a reading, and those steps are not a reader's to take. */}
            {mine ? (
              <a href={`#${STEPS[p.id]}`} className="score-part-label">
                <strong>{p.label}</strong>
                <small className="muted">{p.hint}</small>
              </a>
            ) : (
              <span className="score-part-label">
                <strong>{p.label}</strong>
                <small className="muted">{p.hint}</small>
              </span>
            )}
            <span className="score-part-worth muted">
              {p.earned}/{p.weight}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
