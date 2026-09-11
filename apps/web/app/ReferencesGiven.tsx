import Link from "next/link";
import type { Verification } from "@/lib/api";
import { questionTitle } from "@/lib/questions";

/**
 * What a person has said about anybody else.
 *
 * A page that carries only what others said about them reads as a dossier; this is the half they
 * wrote themselves, and it is what a reader weighing their references has to go on when deciding
 * whether this is somebody who participates or somebody who is only spoken about.
 *
 * Shared by a person's verification and their candidate page, because those are two routes to one
 * question and were answering it differently — one showed this and the other did not.
 */
export function ReferencesGiven({ references }: { references: Verification["references"] }) {
  if (references.length === 0) return null;
  /*
   * An answer is not a reference.
   *
   * One is what somebody said about a question anybody may answer; the other is their name put behind
   * a person. Counted together under "Given" beside a "Received" that counts references only, two
   * different things were being totalled as one — so a page reading "Given (2)" beside "Received (1)"
   * meant one reference each way and an answer besides.
   */
  const answers = references.filter((r) => r.kind === "answer");
  const written = references.filter((r) => r.kind !== "answer");
  return (
    <section className="v-block">
      {answers.length > 0 && written.length > 0 && (
        <p className="muted" data-testid="given-split">
          {written.length} reference{written.length === 1 ? "" : "s"} written, and {answers.length} answer
          {answers.length === 1 ? "" : "s"} to a question anybody may answer.
        </p>
      )}
      <ul className="v-refs" data-testid="references">
        {references.map((ref) => (
          <li key={ref.ensName ?? `${ref.kind}:${ref.subject}`}>
            {/* The graph is only worth showing if a reader can walk it: the subject, and the name this
                reference itself answers at, both lead somewhere. */}
            <span className="v-ref-subject">
              {ref.subjectName ? (
                <Link href={`/v/${ref.subjectName}`}>
                  {ref.kind === "answer" ? questionTitle(ref.subject) : ref.subject}
                </Link>
              ) : ref.kind === "answer" ? (
                questionTitle(ref.subject)
              ) : (
                ref.subject
              )}
            </span>
            <strong className="v-ref-statement">{ref.statement || <em>no words</em>}</strong>
            {ref.ensName && (
              <Link className="v-ref-name" href={`/v/${ref.ensName}`} title="read it back in any ENS client">
                <code>{ref.ensName}</code>
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
