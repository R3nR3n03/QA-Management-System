/**
 * The lifecycle stepper: an ordered list of stages with the current one marked by
 * `aria-current="step"`. State is never color alone — completed steps carry
 * visually-hidden "(complete)" text, and the label always names the stage using the
 * exact doc spelling the caller supplies.
 */
export function Stepper({
  steps,
  currentIndex,
  label
}: {
  steps: { key: string; label: string }[];
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
          {step.label}
          {i < currentIndex ? <span className="sr-only"> (complete)</span> : null}
        </li>
      ))}
    </ol>
  );
}
