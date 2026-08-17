import { ExecutionOutcome } from "@prisma/client";
import { formatInZoneWithName } from "@/lib/time-zone";

/**
 * Composing the result comment QAMS posts on a Jira issue when a run finalizes
 * (`docs/architecture.md#Jira execution sync`, ADR-0004).
 *
 * Pure and free of Prisma and of the network, like `jira-sync.ts` and `catalogue-tree.ts`:
 * the part of this feature that can corrupt someone else's ticket is the part that needs to
 * be testable without a database.
 */

/** One covered case, as the comment needs it. */
export type ResultCommentCase = {
  businessId: string;
  title: string;
  result: ExecutionOutcome;
  actualResult: string;
  blockReason: string | null;
  /** The defect raised or linked for this case, when there is one. */
  defectBusinessId: string | null;
};

export type ResultCommentInput = {
  executionBusinessId: string;
  purpose: string;
  testerName: string;
  /** The execution's derived result. */
  result: ExecutionOutcome;
  finalizedAt: Date;
  cases: ResultCommentCase[];
  /** Deep link back into QAMS, or null when no APP_BASE_URL is configured. */
  runUrl: string | null;
  /**
   * The ORGANIZATION zone the stamp is drawn in — `Asia/Manila`, or `UTC` when the
   * deployment configures none.
   *
   * Passed in rather than read here, exactly as `runUrl` is: this module stays free of the
   * environment so the part of the feature that can corrupt someone else's ticket remains
   * testable without one.
   */
  timeZone: string;
};

/**
 * The characters Jira's wiki markup treats as syntax, escaped with a leading backslash.
 *
 * ## Why this set, and not more
 *
 * These are the characters that can RESTRUCTURE a comment — open a macro that swallows the
 * rest of the body (`{`, `}`), forge a link into somewhere else (`[`, `]`, `|`), embed an
 * image (`!`), break a table row (`|`), or reformat a span (`*`, `_`, `+`, `-`, `^`, `~`,
 * `#`). Left alone are the characters whose worst outcome is cosmetic: `(x)` renders an
 * emoticon and `??` a citation, neither of which can change the shape of the comment or send
 * a reader anywhere. Escaping them was rejected because a backslash before a character Jira
 * does not consider special is not reliably consumed, and a body full of stray backslashes is
 * a worse failure than an accidental smiley.
 *
 * Note what is NOT here: the backslash itself. See `NO_LITERAL_BACKSLASH`.
 */
const WIKI_SPECIAL = /[{}[\]|*_+\-^~!#]/g;

/**
 * The one character wiki markup cannot represent, replaced with a forward slash.
 *
 * `\\` is Jira's **forced line break**, not an escaped backslash — there is no notation for a
 * literal one. So escaping `\` the way every other special character is escaped would emit a
 * line break instead, which is worse than the problem it was meant to solve: it alters what
 * the tester wrote, AND it puts everything after it at the start of a line, which is exactly
 * where `h1.`, `bq.` and `#` become structural again. Collapsing newlines would no longer be
 * enough to keep tester text off a line start.
 *
 * Substituting is therefore not a softening of the "escape, never strip" rule but the only
 * available way to honour it: a backslash cannot be escaped here, so it is turned into
 * something inert that a reader still understands — `C:\temp` reads as `C:/temp` rather than
 * vanishing into `C:temp`.
 *
 * It runs BEFORE escaping, which is what guarantees the escapes added below can never pair
 * with a backslash the tester typed and form a line break by accident.
 */
const NO_LITERAL_BACKSLASH = /\\/g;

/**
 * How much of one free-text field reaches Jira.
 *
 * `actualResult` and `blockReason` are unbounded columns, so without a cap a tester pasting a
 * stack trace puts the whole thing in someone else's ticket — and Jira refuses a comment over
 * 32,767 characters outright, which would turn a large failing run into no comment at all.
 */
export const MAX_FIELD_CHARS = 200;

/**
 * How many non-passing cases are listed before the comment defers to QAMS.
 *
 * A 200-case regression run that fails badly is a report, not a conversation; past this the
 * comment says how many it left out and links to the run.
 */
export const MAX_LISTED_CASES = 50;

/**
 * The ceiling on the whole body, below the 32,767 characters Jira accepts.
 *
 * The two caps above bound what a READER sees; this bounds what is SENT, and they are not the
 * same number. `cap()` runs before escaping — it has to, or truncation could sever a backslash
 * from the character it protects — so a 200-character field of `{` leaves as 400 characters of
 * `\{`. Fifty cases of two such fields clear 40,000 and Jira refuses the comment outright,
 * which is the one failure mode that produces nothing at all rather than something partial.
 *
 * The margin below Jira's limit is deliberate: this counts the string QAMS builds, and it is
 * not worth discovering that something downstream counts differently.
 */
export const MAX_COMMENT_CHARS = 30_000;

/**
 * Caps one free-text field, marking that it was cut.
 *
 * Applied BEFORE escaping, which is not incidental: truncating escaped text could cut between
 * a backslash and the character it protects, leaving a trailing `\` that would escape the
 * ellipsis instead — and, worse, could sever the escape from a `{` and reopen the macro
 * problem this module exists to prevent. Capping the text a reader sees is also the more
 * honest reading of the limit.
 *
 * Exported for `jira-defect.ts`, which writes into the same Jira with the same obligations and
 * must not grow a second, quietly different idea of how long a field may be.
 */
export function cap(raw: string, limit: number = MAX_FIELD_CHARS): string {
  return raw.length <= limit ? raw : `${raw.slice(0, limit)}…`;
}

/**
 * Renders text a tester wrote as literal text inside a wiki-markup body.
 *
 * Every span of this comment that came from a person — the purpose, case titles, block
 * reasons, actual results — passes through here. Without it, a block reason containing
 * `{code}` swallows the rest of the comment, and `[see here|http://elsewhere]` becomes a real
 * link in a ticket QAMS does not own, authored by a QAMS bot (ADR-0004).
 *
 * Newlines are collapsed rather than escaped, and that is load-bearing rather than tidiness:
 * `h1.`, `bq.`, `#` and `*` are structural only at the START of a line, and every line this
 * module emits begins with its own scaffolding. With no newlines in tester text, no tester
 * text can ever reach a line start.
 */
export function escapeWikiMarkup(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(NO_LITERAL_BACKSLASH, "/")
    .replace(WIKI_SPECIAL, "\\$&");
}

/**
 * `2026-08-11 14:32 Asia/Manila`, or `… UTC` where no organization zone is configured.
 *
 * The ORGANIZATION zone, never a viewer's: this comment is read in Jira, by someone who may
 * not be a QAMS user at all and has no preference QAMS could consult, so a viewer zone is
 * undefined here by construction rather than merely unavailable (ADR-0007).
 *
 * The zone is named in full because the reader is a stranger. An abbreviation would not
 * survive that — `IST` is three different zones — and a bare `14:32` would be worse than the
 * old `UTC` suffix, since it would look unambiguous while being anything but.
 *
 * Assembled through `formatInZone`, which fixes the field order itself rather than taking a
 * locale pattern. That preserves the property this function has always had: the output does
 * not depend on where the process happens to be running.
 */
function formatInstant(at: Date, zone: string): string {
  return formatInZoneWithName(at, zone);
}

/** `3 passed, 2 failed, 1 blocked`, dropping the tallies that are zero. */
function tallies(cases: ResultCommentCase[]): string {
  const count = (result: ExecutionOutcome) => cases.filter((one) => one.result === result).length;

  return (
    [
      [count(ExecutionOutcome.PASS), "passed"],
      [count(ExecutionOutcome.FAIL), "failed"],
      [count(ExecutionOutcome.BLOCKED), "blocked"]
    ] as const
  )
    .filter(([n]) => n > 0)
    .map(([n, word]) => `${n} ${word}`)
    .join(", ");
}

/**
 * One bullet for a case that did not pass: what it was, which defect it raised, and what
 * actually happened.
 *
 * The parts that may be absent are dropped rather than rendered empty, so a case with no
 * defect does not read as having one with a blank name.
 */
function caseLine(one: ResultCommentCase): string {
  const detail = one.result === ExecutionOutcome.BLOCKED ? one.blockReason : one.actualResult;

  // Business IDs are NOT escaped: `BUSINESS_ID_PATTERNS` already guarantees they are letters,
  // digits and hyphens, so there is nothing in one to neutralise, and escaping would render
  // `TC\-LOGIN\-0007` in the source of every line for no gain. The title beside it is free
  // text and is escaped.
  return `* ${[
    `${one.businessId} ${escapeWikiMarkup(cap(one.title))}`,
    one.defectBusinessId,
    detail === null ? null : escapeWikiMarkup(cap(detail))
  ]
    .filter((part) => part !== null && part !== "")
    .join(" — ")}`;
}

/** A titled bullet list, or nothing at all when no case had that result. */
function section(title: string, cases: ResultCommentCase[], result: ExecutionOutcome): string[] {
  const matching = cases.filter((one) => one.result === result);
  if (matching.length === 0) return [];

  return ["", `*${title}*`, ...matching.map(caseLine)];
}

/**
 * The comment body, as a Jira wiki-markup string.
 *
 * Passing cases are counted in the header and never listed: a pass has nothing to say beyond
 * that it passed, and listing every one is what makes a large run's comment unreadable.
 */
export function buildResultComment(input: ResultCommentInput): string {
  // Failures first, then blocked, so the caps spend their budget on the cases people act on.
  const nonPassing = [
    ...input.cases.filter((one) => one.result === ExecutionOutcome.FAIL),
    ...input.cases.filter((one) => one.result === ExecutionOutcome.BLOCKED)
  ];

  let shown = Math.min(nonPassing.length, MAX_LISTED_CASES);
  let body = render(input, nonPassing, shown);

  // Measured rather than predicted. How much escaping adds depends on the text, so the only
  // honest way to guarantee Jira accepts this is to look at what was actually built and drop
  // cases until it fits. Bounded by `shown`, and each dropped case is counted in the omission
  // line, so a shortened comment still says how much it is not showing.
  while (body.length > MAX_COMMENT_CHARS && shown > 0) {
    shown -= 1;
    body = render(input, nonPassing, shown);
  }

  return body;
}

/** One rendering of the body, listing `shown` of the non-passing cases. */
function render(input: ResultCommentInput, nonPassing: ResultCommentCase[], shown: number): string {
  const listed = nonPassing.slice(0, shown);
  const omitted = nonPassing.length - listed.length;

  return [
    `*QAMS run ${input.executionBusinessId} — ${escapeWikiMarkup(cap(input.purpose))}*`,
    // Counted from every case, never from the truncated list: the header is the one part of
    // the comment that still tells the whole truth about the run.
    `Result: ${input.result} · ${input.cases.length} ${input.cases.length === 1 ? "case" : "cases"}: ${tallies(input.cases)}`,
    `Tester: ${escapeWikiMarkup(cap(input.testerName))} · Finalized ${formatInstant(input.finalizedAt, input.timeZone)}`,
    ...section("Failed", listed, ExecutionOutcome.FAIL),
    ...section("Blocked", listed, ExecutionOutcome.BLOCKED),
    // Silent truncation would read as a complete list, and a reader would draw conclusions
    // from cases that are simply not shown.
    ...(omitted > 0 ? ["", `…and ${omitted} more, see QAMS`] : []),
    // Not escaped, because this is the one part of the body QAMS built itself: an origin from
    // deployment configuration and a run id. Absent when no APP_BASE_URL is set — a guessed
    // origin would render an authoritative-looking link that goes nowhere.
    ...(input.runUrl === null ? [] : ["", `[Full results in QAMS|${input.runUrl}]`])
  ].join("\n");
}
