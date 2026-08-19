/**
 * The one value a row in an ingested results file is filed under, and how it reads.
 *
 * A check is an OBSERVATION, and everything here reports what a runner already decided rather
 * than grading anything. That distinction matters because
 * `docs/business-rules-and-validation.md` defines no threshold or target, so nothing on these
 * screens may imply a judgement about product quality — and nothing does: a red chip says
 * "this spec reported a failure", never "this release is not ready".
 *
 * ## Why one ordered vocabulary and not two maps
 *
 * A batch report counts check outcomes and row outcomes into a single `counts` map, so this
 * module used to hold two label maps, two tone maps, and a pair of functions that tried each
 * vocabulary in turn. Three screens then each rebuilt the same list in their own order — and
 * the batch list built its from `Object.entries(counts)`, which is file order, so the same
 * outcome appeared in a different position on every row.
 *
 * `CHECK_FILINGS` is that list, once, in a fixed order. The batch list spends it as columns,
 * the batch head spends it as filter slots, and a row's own chip is one lookup into it. They
 * cannot disagree about what `ERRORED` is called or which position it holds.
 *
 * The four check outcomes take their word and their chip from `src/ui/check-outcome.ts` rather
 * than restating them, so `CheckOutcomeChip` and these screens stay one answer.
 */
import { CHECK_OUTCOME_LABEL, CHECK_OUTCOME_TONE } from "@/ui/check-outcome";

export type CheckFiling = {
  /** The key `counts` is keyed by, and the value the row filter matches on. */
  key: string;
  /** Sentence case: a chip, a column heading, a filter slot. */
  label: string;
  /** `.state` tone classes. */
  chip: string;
  /**
   * `.tally-slot[data-tone]`, or undefined for the neutral slot.
   *
   * Not derived from `chip` by string surgery: the two are separate presentations of the same
   * fact and a future tone may exist in one and not the other.
   */
  slotTone?: "pass" | "fail" | "blocked";
  /**
   * Whether this filing means the row reached no test case at all.
   *
   * The property the "recorded no check" summary and its filter are built from, so neither has
   * to restate which two of the six count — and so a seventh unresolved outcome would be
   * included by declaring itself rather than by someone remembering to widen a union.
   */
  unresolved: boolean;
};

/**
 * The fixed order. Observed outcomes first, worst-first within them, then the two ways a row
 * can produce nothing — which is the order a reader asks the questions in: what did the run
 * see, and did any of it miss.
 */
export const CHECK_FILINGS: readonly CheckFiling[] = [
  {
    key: "PASSED",
    label: CHECK_OUTCOME_LABEL.PASSED,
    chip: CHECK_OUTCOME_TONE.PASSED,
    slotTone: "pass",
    unresolved: false
  },
  {
    key: "FAILED",
    label: CHECK_OUTCOME_LABEL.FAILED,
    chip: CHECK_OUTCOME_TONE.FAILED,
    slotTone: "fail",
    unresolved: false
  },
  {
    // Held apart from FAILED at every one of the three places a person reads it. A spec that
    // fell over is not software that broke (`docs/business-rules-and-validation.md`).
    key: "ERRORED",
    label: CHECK_OUTCOME_LABEL.ERRORED,
    chip: CHECK_OUTCOME_TONE.ERRORED,
    slotTone: "blocked",
    unresolved: false
  },
  {
    key: "SKIPPED",
    label: CHECK_OUTCOME_LABEL.SKIPPED,
    chip: CHECK_OUTCOME_TONE.SKIPPED,
    unresolved: false
  },
  {
    // Both of these need a person to do something next — point a spec at a case that exists,
    // or name one at all — so neither may look like the row that worked.
    key: "REFERENCE_NOT_FOUND",
    label: "No such test case",
    chip: "state state-fail",
    slotTone: "fail",
    unresolved: true
  },
  {
    key: "NO_TEST_CASE_DECLARED",
    label: "Names no test case",
    chip: "state state-blocked",
    slotTone: "blocked",
    unresolved: true
  }
];

/** The four a check actually records, for the batch list's own count columns. */
export const OBSERVED_FILINGS = CHECK_FILINGS.filter((filing) => !filing.unresolved);

/** The two that record a row which produced no check. */
export const UNRESOLVED_FILINGS = CHECK_FILINGS.filter((filing) => filing.unresolved);

/**
 * The heading the two unresolved counts are summed under on the batch list.
 *
 * One column and not two, deliberately: at list level the actionable signal is "this run had
 * rows that reached no case, open it", and the batch report splits them because that is where
 * the difference decides what to fix. Stated here so the column and the copy that explains it
 * cannot drift apart.
 */
export const UNRESOLVED_COLUMN_LABEL = "Reached no case";

/**
 * A filing for any key, including one this module has never heard of.
 *
 * An unknown value renders as a humanised word on the neutral chip rather than as a raw enum
 * or an unclassed span — the failure is otherwise silent, and a run that reported something
 * new would look deliberate while quietly under-reporting itself.
 */
export function filingFor(key: string): CheckFiling {
  const known = CHECK_FILINGS.find((filing) => filing.key === key);
  if (known) return known;
  const humanised = key.toLowerCase().replace(/_/g, " ");
  return {
    key,
    label: humanised.charAt(0).toUpperCase() + humanised.slice(1),
    chip: "state",
    unresolved: false
  };
}

/**
 * Which filing one row belongs to.
 *
 * A row that created a check is filed under what the spec observed; a row that created none is
 * filed under why. Exactly the rule `tally` in `src/domain/checks.ts` uses to build `counts`,
 * restated here so the row's chip and the tally counting it are the same decision.
 */
export function filingKeyOf(outcome: string, checkOutcome: string | null): string {
  return outcome === "CREATED" ? (checkOutcome ?? outcome) : outcome;
}
