import type { ReactNode } from "react";

export type StepState = "done" | "now" | "todo" | "pending";

/**
 * One group with one subject, shared by the profile and the claim journey: a mark that carries the
 * state, a title, and the work.
 */
export function Step({
  title,
  state,
  anchor,
  children,
}: {
  title: string;
  state: StepState;
  /** Where the score links to when this step is what is missing */
  anchor?: string;
  children: ReactNode;
}) {
  return (
    <section id={anchor} className={`card dash-step dash-${state}`} data-testid={`step-${anchor ?? title}`}>
      {/* A tick when it is done and nothing when it is not: these are things to do, not an order to
          do them in, so numbering them said something untrue. */}
      <span className="dash-num" aria-hidden>
        {state === "done" ? "✓" : state === "pending" ? "…" : "·"}
      </span>
      <div>
        <h2>{title}</h2>
        {children}
      </div>
    </section>
  );
}
