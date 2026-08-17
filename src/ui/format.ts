import { HourFormat, type ExecutionOutcome } from "@prisma/client";
import { viewerTimeZone } from "@/lib/app-config";
import { DEFAULT_HOUR_CLOCK, formatInZone, type HourClock } from "@/lib/time-zone";

/**
 * The presentation formatting two or more screens have to agree on.
 *
 * Anything here is shared BECAUSE a difference between screens would be a bug: a run in the
 * executions list and the same run in My work must render the same stamp and the same
 * outcome tally, or a reader comparing the two learns something untrue.
 */

/**
 * Everything a screen needs in order to draw a stamp: which clock, and which zone.
 *
 * ONE object rather than two arguments threaded separately, because they answer one question —
 * how does this reader see an instant — and every component that draws a stamp needs both.
 * Two props would mean every future preference re-touched all ten call sites; one means the
 * seam is already the right shape.
 *
 * Plain and serializable, so it crosses into a client component unchanged.
 */
export type StampFormat = {
  timeZone: string;
  clock: HourClock;
};

/**
 * The stamp format for one signed-in reader, resolved from what `requireAuth` already loaded.
 *
 * Call this once per render and pass the result down. Resolving per component would let two
 * halves of one screen disagree, which is the failure this module exists to prevent.
 *
 * The two preferences fall back differently, and deliberately so. The **zone** chains through
 * the deployment's own — `viewerTimeZone` — because a Jira comment needs an organization
 * zone anyway and a viewer who has chosen nothing is best served by it. The **clock** has no
 * such middle step: Jira is fixed at 24-hour, so no deployment-level value exists to fall
 * through to, and `null` resolves straight to `DEFAULT_HOUR_CLOCK` (ADR-0007).
 */
export function viewerStampFormat(viewer: {
  timeZone: string | null;
  hourFormat: HourFormat | null;
}): StampFormat {
  return {
    timeZone: viewerTimeZone(viewer.timeZone),
    clock: hourClockFor(viewer.hourFormat)
  };
}

/**
 * The stored preference as `Intl` names it.
 *
 * This mapping is the reason `src/lib/time-zone.ts` speaks in `"h12" | "h23"` rather than in
 * the Prisma enum: that module is reachable from `src/instrumentation.ts`, which is compiled
 * for the Edge runtime, and the Prisma client must not enter that graph. This file is UI and
 * never is, so the enum is safe here.
 */
export function hourClockFor(hourFormat: HourFormat | null): HourClock {
  if (hourFormat === HourFormat.H12) return "h12";
  if (hourFormat === HourFormat.H24) return "h23";
  return DEFAULT_HOUR_CLOCK;
}

/**
 * The one timestamp rendering for screens: `2026-08-17 14:30`, or `2026-08-17 02:30 PM` on a
 * 12-hour clock, to the minute, in the viewer's zone.
 *
 * Timestamps remain UTC instants in the record (`docs/data-model.md`) — this is presentation
 * and changes nothing that is stored.
 *
 * ## Why the format is an argument and not a default
 *
 * This was `formatUtcMinute(value)` and rendered a fixed `... UTC`. Taking the format
 * explicitly means no call site can render a stamp without having said how, which is the only
 * mechanical guard against a screen quietly falling back to somebody else's preferences.
 * Resolve it once per render with `viewerStampFormat(auth)`.
 *
 * ## Why there is no zone label on the stamp itself
 *
 * The zone is constant for a viewer across every stamp on every screen, so repeating it down
 * forty rows of an executions list is noise that trains people to stop reading it. It is
 * stated once, in the shell beside the viewer's name, which is where somebody unsure of it
 * actually looks. The CLOCK needs no such statement: `02:30 PM` and `14:30` announce which
 * one they are simply by being read. A stamp written for a reader who has no shell — a Jira
 * comment — carries its zone in the text instead, via `formatInZoneWithName` (ADR-0007).
 *
 * The instant stays machine-readable regardless: every caller pairs this with a `<time>`
 * element whose `dateTime` attribute is the unambiguous ISO-8601 UTC value.
 */
export function formatMinute(value: Date, format: StampFormat): string {
  return formatInZone(value, format.timeZone, format.clock);
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
