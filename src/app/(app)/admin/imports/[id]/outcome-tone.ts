/**
 * Chip tones for the import screens.
 *
 * These are system-operation outcomes, not graded QA results. The reserved palette is
 * still barred from expressing a judgement about PRODUCT quality that policy has not
 * defined (`docs/business-rules-and-validation.md:37-38` — no percentage, threshold or
 * ageing target) — but "this row was rejected" and "this run errored" are facts the
 * import already decided, not judgements this screen is inventing. They are marked
 * accordingly, because the alternative was worse: a failed run rendered identically to
 * a successful one, so someone could read "my workbook imported" off a run that had
 * imported nothing.
 *
 * Words still carry the meaning; the tone only decides what the eye lands on first when
 * scanning several hundred rows.
 */

/** Outcome of one staged row. */
export const OUTCOME_TONE: Record<string, string> = {
  CREATED: "state state-accent",
  SKIPPED_UNCHANGED: "state",
  // The two that need a person to do something next, and used to be the two that
  // looked like the two that did not.
  RECONCILIATION_REQUIRED: "state state-blocked",
  REJECTED: "state state-fail"
};

/** Status of a whole import run. */
export const RUN_STATUS_TONE: Record<string, string> = {
  RUNNING: "state state-accent",
  COMPLETED: "state state-pass",
  FAILED: "state state-fail"
};

/** Unknown values fall back to the neutral chip rather than an unclassed span. */
export function toneFor(map: Record<string, string>, key: string): string {
  return map[key] ?? "state";
}
