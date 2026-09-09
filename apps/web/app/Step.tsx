import type { ReactNode } from "react";

export type StepState = "done" | "now" | "todo";

/**
 * One numbered group with one subject. Shared by the profile and the claim journey so a candidate
 * sees the same shape in both places: a number that carries the state, a title, and the work.
 */
export function Step({
  n,
  title,
  state,
  children,
}: {
  n: number;
  title: string;
  state: StepState;
  children: ReactNode;
}) {
  return (
    <section className={`card dash-step dash-${state}`} data-testid={`step-${n}`}>
      <span className="dash-num" aria-hidden>
        {state === "done" ? "✓" : n}
      </span>
      <div>
        <h2>{title}</h2>
        {children}
      </div>
    </section>
  );
}
