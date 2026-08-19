import { CircleCheck, CirclePlay, CircleSlash, CircleX, ClipboardList } from "lucide-react";
import { ExecutionLifecycleState, type ExecutionOutcome } from "@prisma/client";

/**
 * The mark that leads a row about an execution run.
 *
 * Decorative on purpose — `aria-hidden` at every call site, because the chip beside it already
 * says the state or the outcome in words. What it adds is somewhere for the eye to land when
 * scanning a column of otherwise identical rows, and an alignment: every row's record starts at
 * the same x, so a list of runs reads as a column rather than as a stack of paragraphs.
 *
 * ## Why this module exists
 *
 * These lived in `work-queue.tsx`, which meant the two lists of executions in the product — My
 * work's queue and `/executions` — could not share them without the general list importing from
 * the tester's front door. They are one vocabulary about one record, so they live in one place
 * that neither list owns.
 *
 * The tones are `.row-mark[data-tone]`, and they are the SAME ones the rows' chips use, so a mark
 * and the words beside it can never look like different claims. Nothing here grades anything: an
 * outcome mark repeats a result a person already recorded (`docs/business-rules-and-validation.md`
 * defines no threshold to grade it against).
 */

/** A run that has not been graded yet: planned, or being worked. */
export function StateMark({ state }: { state: ExecutionLifecycleState }) {
  const started = state === ExecutionLifecycleState.IN_PROGRESS;
  return (
    <span className="row-mark" data-tone={started ? "progress" : "planned"} aria-hidden>
      {started ? <CirclePlay size={18} /> : <ClipboardList size={18} />}
    </span>
  );
}

/**
 * A finished run, keyed to what it recorded.
 *
 * A null result should not occur on a finalized run, and the mark goes neutral when it does: a
 * green tick for an outcome nobody recorded would be the one case where this says something the
 * chip beside it does not.
 */
export function OutcomeMark({ outcome }: { outcome: ExecutionOutcome | null }) {
  if (outcome === null) {
    return (
      <span className="row-mark" aria-hidden>
        <ClipboardList size={18} />
      </span>
    );
  }
  return (
    <span className="row-mark" data-tone={outcome.toLowerCase()} aria-hidden>
      {outcome === "FAIL" ? (
        <CircleX size={18} />
      ) : outcome === "BLOCKED" ? (
        <CircleSlash size={18} />
      ) : (
        <CircleCheck size={18} />
      )}
    </span>
  );
}

/**
 * The mark for a list that holds runs in every state at once — `/executions`, where My work
 * splits the same records across two lists and so knows which of the two above it needs.
 *
 * A finalized run is marked by its OUTCOME and an open one by its state, which is the same
 * decision each row's chips make: an open run shows a state chip, a closed one adds the result.
 * The mark follows the loudest fact about the row rather than always showing the same axis.
 */
export function RunMark({
  state,
  result
}: {
  state: ExecutionLifecycleState;
  result: ExecutionOutcome | null;
}) {
  return state === ExecutionLifecycleState.FINALIZED ? (
    <OutcomeMark outcome={result} />
  ) : (
    <StateMark state={state} />
  );
}
