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
  return (
    <section className="v-block">
      <h3>References given</h3>
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
