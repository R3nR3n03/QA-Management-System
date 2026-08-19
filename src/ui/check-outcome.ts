/**
 * What a check outcome is called, and how it is toned — as plain string maps.
 *
 * Split out of `chips.tsx` because that module imports `@prisma/client` enum **values**, and
 * the batch row table is a client component: `case-table.tsx` records the same constraint,
 * and `StepsDisclosure` takes plain objects for the same reason. Keeping the words and the
 * tones here means the chip and the table cannot disagree about what `ERRORED` is called.
 *
 * ERRORED deliberately does not take the failure tone. Keeping it apart from FAILED is the
 * whole point: a broken spec is not broken software, and rendering them alike would undo
 * that at the one place a person actually reads it.
 *
 * Keyed by plain `string` rather than by the enum, so a client component never has to name
 * the enum to look a value up.
 */
export const CHECK_OUTCOME_LABEL: Record<string, string> = {
  PASSED: "Passed",
  FAILED: "Failed",
  ERRORED: "Errored",
  SKIPPED: "Skipped"
};

export const CHECK_OUTCOME_TONE: Record<string, string> = {
  PASSED: "state state-pass",
  FAILED: "state state-fail",
  ERRORED: "state state-blocked",
  SKIPPED: "state"
};
