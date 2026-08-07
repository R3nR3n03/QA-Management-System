/**
 * A test case's steps, folded.
 *
 * The same disclosure on every screen that shows a case inside a run — the read-only
 * covered-case row, the working row on an In Progress run, and the dialog that records a
 * result. It was inlined in the first of those only, which is how the finalize flow ended
 * up able to say "2 steps" without ever showing them: a tester grading a case could not
 * read what they were meant to do.
 *
 * Takes plain objects, not Prisma rows, so a client component can render it without
 * pulling `@prisma/client` into the browser bundle.
 */
export type CaseStep = { id: string; action: string; expectedResult: string };

export function StepsDisclosure({ steps, open = false }: { steps: CaseStep[]; open?: boolean }) {
  // A case with no steps says so. An empty disclosure would be a control that opens onto
  // nothing, which reads as a failure to load rather than as an absence.
  if (steps.length === 0) {
    return <p className="muted">This test case has no steps recorded.</p>;
  }

  return (
    <details className="case-steps" open={open}>
      <summary>
        {steps.length} step{steps.length === 1 ? "" : "s"}
      </summary>
      <ol>
        {steps.map((step) => (
          <li key={step.id}>
            <div>{step.action}</div>
            <div className="case-step-expected">Expected: {step.expectedResult}</div>
          </li>
        ))}
      </ol>
    </details>
  );
}
