import type { ReactNode } from "react";

/**
 * The lifecycle stepper: an ordered list of stages with the current one marked by
 * `aria-current="step"`. State is never color alone — completed steps carry
 * visually-hidden "(complete)" text, and the label always names the stage using the
 * exact doc spelling the caller supplies.
 *
 * A step may carry a `hint` — the moment it was reached. It sits inside the step it
 * belongs to rather than in a separate timeline, so "which stage" and "when" are read
 * as one fact. A stage that has not happened yet simply omits it: an empty slot would
 * claim the stage has a blank timestamp rather than no timestamp.
 *
 * Two variants, same list and same semantics:
 *
 * - `bar` (default) — a thin segmented rail. The stage is context on a screen whose
 *   subject is something else (a test case, a defect).
 * - `cards` — a tile per stage, with room for an icon and a legible timestamp. For a
 *   record whose lifecycle IS the headline: an execution run, where "how far did this
 *   get and when" is the first question a reader arrives with.
 *
 * An `icon` is honoured in either variant and replaces the dot. It is decorative —
 * `aria-hidden`, with the stage's name in the adjacent label.
 */
export function Stepper({
  steps,
  currentIndex,
  label,
  variant = "bar"
}: {
  steps: { key: string; label: string; hint?: string; icon?: ReactNode }[];
  currentIndex: number;
  label: string;
  variant?: "bar" | "cards";
}) {
  return (
    <ol className={variant === "cards" ? "stepper stepper-cards" : "stepper"} aria-label={label}>
      {steps.map((step, i) => (
        <li
          key={step.key}
          aria-current={i === currentIndex ? "step" : undefined}
          className={i < currentIndex ? "step-done" : undefined}
        >
          {step.icon ? (
            <span className="step-icon" aria-hidden>
              {step.icon}
            </span>
          ) : (
            <span className="step-dot" aria-hidden />
          )}
          <span className="step-text">
            <span className="step-label">
              {step.label}
              {i < currentIndex ? <span className="sr-only"> (complete)</span> : null}
            </span>
            {step.hint ? <span className="step-hint">{step.hint}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}
