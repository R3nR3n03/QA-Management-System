import type { ExecutionOutcome } from "@prisma/client";

/**
 * The presentation formatting two or more screens have to agree on.
 *
 * Anything here is shared BECAUSE a difference between screens would be a bug: a run in the
 * executions list and the same run in My work must render the same stamp and the same
 * outcome tally, or a reader comparing the two learns something untrue.
 */

/**
 * The one timestamp rendering for screens. Timestamps are UTC ISO-8601 in the record
 * (`docs/data-model.md:5`); screens show them to the minute, labelled UTC, so two rows
 * rendered by different pages can never disagree about the format.
 */
export function formatUtcMinute(value: Date): string {
  return `${value.toISOString().replace("T", " ").slice(0, 16)} UTC`;
}

/**
 * "2 passed, 1 failed" for a finalized run covering more than one case.
 *
 * The run's own chip carries only the derived worst outcome
 * (`docs/business-rules-and-validation.md:30`), so a 9-pass/1-fail run and a 10-fail run
 * are the same red Fail chip. This says which, in words, without a second colour channel
 * on a row that already has two. Counted in a fixed order so two rows always read the
 * same way, and outcomes with no cases are omitted rather than printed as zero.
 *
 * Shared by the executions list and the My work recap: the same run appears in both, and
 * they must not describe it differently.
 */
export function outcomeBreakdown(results: Array<ExecutionOutcome | null>): string {
  const order: Array<[ExecutionOutcome, string]> = [
    ["PASS" as ExecutionOutcome, "passed"],
    ["FAIL" as ExecutionOutcome, "failed"],
    ["BLOCKED" as ExecutionOutcome, "blocked"]
  ];
  const parts = order
    .map(([outcome, word]) => [results.filter((r) => r === outcome).length, word] as const)
    .filter(([count]) => count > 0)
    .map(([count, word]) => `${count} ${word}`);
  return parts.join(", ");
}
