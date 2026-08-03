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
 */
export function Stepper({
  steps,
  currentIndex,
  label
}: {
  steps: { key: string; label: string; hint?: string }[];
  currentIndex: number;
  label: string;
}) {
  return (
    <ol className="stepper" aria-label={label}>
      {steps.map((step, i) => (
        <li
          key={step.key}
          aria-current={i === currentIndex ? "step" : undefined}
          className={i < currentIndex ? "step-done" : undefined}
        >
          <span className="step-dot" aria-hidden />
          <span className="step-text">
            <span>
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
