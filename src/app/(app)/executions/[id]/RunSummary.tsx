"use client";

import { DRAFT_PREFIX, draftResults, useDraftRaw } from "./finalize-draft";

export type SummaryCase = {
  testCaseId: string;
  /** The result PERSISTED against the covered case — null until the run is finalized. */
  result: string | null;
};

/**
 * The run's tally: a count of what has been graded, never a rate, a threshold or a
 * judgement, which `docs/business-rules-and-validation.md:37-38` does not define.
 *
 * ## Why this counts the draft too
 *
 * A per-case result cannot be written before the whole run is finalized
 * (`docs/business-rules-and-validation.md:28`), so on an In Progress run every persisted
 * result is still null and this card, reading only the server, sat at "Pass 0 / Not graded
 * 6" while the tester watched their own recorded Pass on the row below it. Two numbers for
 * one run, on one screen, and the wrong one on top.
 *
 * So where the run is being worked, the card counts the held draft over the persisted
 * results — the same store the working list and the "n of m recorded" count read, so the
 * three cannot disagree — and says plainly that those results are held rather than
 * written. It stays a count of results the tester chose; it does not invent a result for a
 * case nobody has recorded, and nothing here writes anything.
 *
 * `draft` is null on every other state, where the persisted results ARE the run's grades
 * and there is no draft to reconcile. Rendered on the client either way: the counts must
 * re-read once the draft is available after hydration, and `getServerSnapshot` returning
 * "no draft" keeps the server-rendered HTML stable until then.
 */
export function RunSummary({
  cases,
  draft
}: {
  cases: SummaryCase[];
  draft: { executionId: string; version: number } | null;
}) {
  const held = useDraftRaw(draft ? `${DRAFT_PREFIX}${draft.executionId}` : null);
  const recorded = draft
    ? draftResults(held, draft.version, cases.map((covered) => covered.testCaseId))
    : {};

  // The draft wins where it has an entry, because on a run being worked the persisted
  // result is null by rule — there is nothing for it to overwrite.
  const resultOf = (covered: SummaryCase) => recorded[covered.testCaseId]?.result ?? covered.result;
  const countOf = (outcome: string) => cases.filter((covered) => resultOf(covered) === outcome).length;
  const ungraded = cases.filter((covered) => resultOf(covered) === null).length;
  const heldCount = cases.length - ungraded;

  return (
    <div className="run-summary">
      <div className="run-summary-title">Result summary</div>
      <dl className="run-stats">
        <div className="run-stat">
          <dt>Total</dt>
          <dd>{cases.length}</dd>
        </div>
        <div className="run-stat run-stat-pass">
          <dt>Pass</dt>
          <dd>{countOf("PASS")}</dd>
        </div>
        <div className="run-stat run-stat-fail">
          <dt>Fail</dt>
          <dd>{countOf("FAIL")}</dd>
        </div>
        <div className="run-stat run-stat-blocked">
          <dt>Blocked</dt>
          <dd>{countOf("BLOCKED")}</dd>
        </div>
        {/* Always, including at zero: a fixed set of columns means two runs read the
            same shape side by side, and "Not graded 0" is the useful statement that
            nothing was left ungraded — not a gap the reader has to interpret. */}
        <div className="run-stat">
          <dt>Not graded</dt>
          <dd>{ungraded}</dd>
        </div>
      </dl>
      {/* Only once the draft is actually contributing. The card must not claim numbers are
          unwritten when they are the finalized record, nor imply a draft exists before one
          does — and on a run with nothing recorded yet, every number above is zero and the
          sentence would be about nothing. */}
      {draft && heldCount > 0 ? (
        <p className="run-summary-note">
          Counting {heldCount} result{heldCount === 1 ? "" : "s"} held in this tab. Nothing is
          written until you finalize.
        </p>
      ) : null}
    </div>
  );
}
