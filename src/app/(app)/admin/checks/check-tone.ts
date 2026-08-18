/**
 * Chip tones for automation checks.
 *
 * A check is an OBSERVATION, and these tones report what a runner already decided rather
 * than grading anything. That distinction matters here because
 * `docs/business-rules-and-validation.md` defines no threshold or target, so nothing on
 * these screens may imply a judgement about product quality — and nothing does: a red chip
 * says "this spec reported a failure", never "this release is not ready".
 *
 * The outcome of a check itself is drawn by `CheckOutcomeChip` in `src/ui/chips.tsx`,
 * beside every other chip in the system. What is left here belongs to these two screens
 * alone: what became of a row in an uploaded file, and how one batch ended.
 */
/** What became of one row in an uploaded file. */
export const ROW_OUTCOME_TONE: Record<string, string> = {
  CREATED: "state state-accent",
  // Both need a person to do something next — point a spec at a case that exists, or name
  // one at all — so neither may look like the row that worked.
  REFERENCE_NOT_FOUND: "state state-fail",
  NO_TEST_CASE_DECLARED: "state state-blocked"
};

export const ROW_OUTCOME_LABEL: Record<string, string> = {
  CREATED: "Check recorded",
  REFERENCE_NOT_FOUND: "No such test case",
  NO_TEST_CASE_DECLARED: "Names no test case"
};

/** Unknown values fall back to the neutral chip rather than an unclassed span. */
export function checkToneFor(map: Record<string, string>, key: string): string {
  return map[key] ?? "state";
}

/**
 * How one tally reads in prose. The batch report counts check outcomes and row outcomes in
 * one map, so this covers both — without it the list rendered raw enum keys at a reader
 * ("1 no_test_case_declared").
 */
const COUNT_LABEL: Record<string, string> = {
  PASSED: "passed",
  FAILED: "failed",
  ERRORED: "errored",
  SKIPPED: "skipped",
  REFERENCE_NOT_FOUND: "naming no such test case",
  NO_TEST_CASE_DECLARED: "naming no test case"
};

export function countLabel(key: string): string {
  return COUNT_LABEL[key] ?? key.toLowerCase().replace(/_/g, " ");
}
