import { DefectLifecycleState } from "@prisma/client";
import { AppError } from "@/lib/errors";
import { formatInZoneWithName } from "@/lib/time-zone";
import { cap, escapeWikiMarkup } from "@/domain/jira-comment";

/**
 * Composing what QAMS writes into Jira for a defect: the bug it raises, and the comments that
 * narrate that defect's lifecycle (`docs/architecture.md#Jira defect sync`, ADR-0006).
 *
 * Pure and free of Prisma and of the network, like `jira-sync.ts` and `jira-comment.ts`. The
 * same rule applies here and matters more: this module composes records CREATED in another
 * team's project, so the part that can put wrong or dangerous text in front of people who have
 * never heard of QAMS is the part that must be testable without a database.
 *
 * Every span of text a person typed passes through `escapeWikiMarkup` before it reaches the
 * description or a comment, for the reasons ADR-0004 sets out — a summary containing `{code}`
 * would otherwise swallow the rest of the body, and `[click|http://elsewhere]` would become a
 * real link in an issue QAMS does not own.
 */

/**
 * Jira's hard limit on an issue summary.
 *
 * Jira refuses a create whose summary exceeds this outright, so a defect with a long summary
 * would otherwise produce no bug at all rather than a shortened one. The cap is applied to the
 * text a reader sees; the full summary is always one click away in QAMS.
 */
export const MAX_SUMMARY_CHARS = 255;

/** How much of one free-text field reaches the description or a comment. */
export const MAX_DEFECT_FIELD_CHARS = 500;

/**
 * The prefix of the label that ties a Jira issue back to the QAMS defect that raised it.
 *
 * This label is the ONLY thing that makes creation safely retryable. A create can succeed in
 * Jira and still fail to be recorded here — the process can be killed between Jira's answer
 * and the write that stores the key — and without a way to recognise our own issue, the retry
 * would raise a second bug for the same defect. Duplicate bugs in a shared project are exactly
 * the kind of mess that is tedious to clean up and impossible to clean up invisibly.
 *
 * So before creating, the transport searches for this label; finding it adopts the existing
 * issue instead of raising another (`findIssueByLabel`).
 */
export const QAMS_DEFECT_LABEL_PREFIX = "qams-";

/**
 * The label for one defect, for example `qams-BUG-0001`.
 *
 * Safe to interpolate into JQL unescaped BECAUSE `BUSINESS_ID_PATTERNS.defect` already
 * guarantees the business ID is letters, digits and hyphens — there is no quote, no space and
 * no JQL operator that could survive that pattern. The caller still quotes it; this is why
 * that quoting can never be broken from here.
 */
export function qamsDefectLabel(defectBusinessId: string): string {
  return `${QAMS_DEFECT_LABEL_PREFIX}${defectBusinessId}`;
}

/**
 * The shape of a Jira project key — at least two characters, starting with a letter, then
 * letters and digits.
 *
 * The same shape the project half of `JIRA_ISSUE_KEY_PATTERN` accepts, and deliberately NOT a
 * member of `BUSINESS_ID_PATTERNS` for the reason that constant already records: those
 * identify QAMS records, and this names a project in someone else's database.
 */
export const JIRA_PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9]+$/;

const JIRA_PROJECT_KEY_FIELD = "jiraProjectKey";

/**
 * Trims and validates a product's Jira project key, or resolves absence to `null`.
 *
 * Absence is legal and is the default for every product: a product with no key raises no
 * bugs. Blank and whitespace-only input are treated as absence rather than rejected, because
 * clearing the field in a form means "this product raises nothing" — which is how the sync is
 * switched off for a product, and must not be an error.
 *
 * Only the SHAPE is checked. A well-formed key naming a project that does not exist in Jira
 * is accepted here on purpose, exactly as `normalizeJiraIssueKey` accepts an absent issue:
 * verifying it would mean calling Jira while editing the catalogue, which would let a Jira
 * outage block a QA Lead from renaming a product. A key that resolves to nothing surfaces
 * later as a failed create attempt, where it costs nobody their work.
 *
 * Upper-cased rather than refused, unlike the environment variable this replaced. That was
 * deployment configuration edited once by someone reading a comment above it; this is a form
 * field a QA Lead types, and `sp` is a typo with one obvious intention rather than an
 * ambiguity worth an error message.
 */
export function normalizeJiraProjectKey(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;

  const trimmed = raw.trim().toUpperCase();
  if (trimmed === "") return null;

  if (!JIRA_PROJECT_KEY_PATTERN.test(trimmed)) {
    throw new AppError(
      422,
      "ID_INVALID",
      "Jira project key must be letters and digits, starting with a letter, for example SP.",
      JIRA_PROJECT_KEY_FIELD
    );
  }

  return trimmed;
}

/** What raising a bug in Jira needs to know about the defect. */
export type DefectIssueInput = {
  defectBusinessId: string;
  summary: string;
  priority: string;
  severity: string;
  /** The test case the defect was raised against. */
  testCaseBusinessId: string;
  testCaseTitle: string;
  reporterName: string;
  /** Deep link back into QAMS, or null when no APP_BASE_URL is configured. */
  defectUrl: string | null;
};

/** The fields of the issue to create, ready for the transport to send. */
export type DefectIssueFields = {
  summary: string;
  /** Jira wiki markup, on the v2 API — see `createIssue` in `jira-transport.ts`. */
  description: string;
  labels: string[];
};

/**
 * The bug QAMS raises for a defect.
 *
 * ## Why the summary carries the QAMS ID
 *
 * `BUG-0001 Checkout total excludes VAT` rather than the bare summary. A developer reading a
 * board sees which QAMS defect a bug came from without opening it, and — more practically — a
 * person searching Jira for `BUG-0001` finds it. The label serves the machine; the prefix
 * serves the human.
 *
 * ## Why priority is in the description and not on the issue
 *
 * QAMS priority and severity are controlled values a QA Lead maintains
 * (`docs/business-rules-and-validation.md`); Jira's priority is a per-instance field whose
 * allowed names the deployment chooses. Sending an unrecognised name does not degrade — Jira
 * refuses the whole create with a 400, so one mismatched value would mean no bug is ever
 * raised. Carrying both in the description states them plainly, cannot fail, and needs no
 * mapping table to be kept in step with two systems at once. A deployment that wants them as
 * real Jira fields can map them later; a deployment that does not is not blocked on it.
 */
export function buildDefectIssueFields(input: DefectIssueInput): DefectIssueFields {
  // The business ID is NOT escaped: `BUSINESS_ID_PATTERNS` guarantees letters, digits and
  // hyphens, so there is nothing in one to neutralise. The summary beside it is free text.
  // Escaping is skipped for the summary too, but for a different reason: a Jira summary is a
  // plain-text field and is never rendered as markup. Newlines are still collapsed, because a
  // summary is a single line and Jira stores what it is given.
  const summary = cap(
    `${input.defectBusinessId} ${input.summary.replace(/\s+/g, " ").trim()}`,
    MAX_SUMMARY_CHARS
  );

  const field = (raw: string) => escapeWikiMarkup(cap(raw, MAX_DEFECT_FIELD_CHARS));

  const description = [
    `*Raised from QAMS defect ${input.defectBusinessId}*`,
    "",
    `*Summary:* ${field(input.summary)}`,
    `*Against:* ${input.testCaseBusinessId} ${field(input.testCaseTitle)}`,
    // Stated as text rather than mapped onto Jira's own fields — see the note above. Empty
    // is rendered as "not set" rather than as a blank, so a reader can tell an unset value
    // from a formatting accident.
    `*Priority:* ${input.priority.trim() === "" ? "not set" : field(input.priority)}`,
    `*Severity:* ${input.severity.trim() === "" ? "not set" : field(input.severity)}`,
    `*Reported by:* ${field(input.reporterName)}`,
    "",
    // QAMS remains the system of record. The description is a readable summary of the defect,
    // never a replacement for it, and this line is what keeps that true as the defect moves on.
    ...(input.defectUrl === null
      ? ["This defect is tracked in QAMS, which holds its current status."]
      : [`[Track this defect in QAMS|${input.defectUrl}]`])
  ].join("\n");

  return {
    summary,
    description,
    // One label, and it is load-bearing rather than decorative: it is how a retry recognises
    // an issue this defect already raised. See QAMS_DEFECT_LABEL_PREFIX.
    labels: [qamsDefectLabel(input.defectBusinessId)]
  };
}

/** One rationale a transition carried, as the comment renders it. */
export type DefectTransitionNote = { label: string; value: string };

export type DefectLifecycleCommentInput = {
  defectBusinessId: string;
  from: DefectLifecycleState;
  to: DefectLifecycleState;
  actorName: string;
  occurredAt: Date;
  /** The rationale fields this transition required, in the order they should read. */
  notes: DefectTransitionNote[];
  defectUrl: string | null;
  /**
   * The ORGANIZATION zone the stamp is drawn in, or `UTC` where none is configured. Passed
   * in rather than read, keeping this module free of the environment like `defectUrl`.
   */
  timeZone: string;
};

/**
 * `2026-08-12 14:32 Asia/Manila`. The same choice, for the same reason, as `jira-comment.ts`:
 * the organization's zone and never a viewer's, named in full because the reader is a
 * stranger to QAMS, and assembled field by field so the output never depends on where the
 * process runs (ADR-0007).
 */
function formatInstant(at: Date, zone: string): string {
  return formatInZoneWithName(at, zone);
}

/** Jira's status words read better than the enum's SHOUTING_SNAKE_CASE. */
function readable(status: DefectLifecycleState): string {
  return status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, " ");
}

/**
 * The comment posted when a defect changes state.
 *
 * ## Why every transition comments, and only closure transitions the issue
 *
 * The same division ADR-0004 draws for executions. A comment REPORTS — "BUG-0001 moved to
 * Resolved, here is the fix" is true when written and stays true — while a transition CLAIMS
 * the work is finished. So the narration runs on every step and the issue moves once, at
 * closure (`shouldTransitionDefectIssue`).
 *
 * The rationale fields carry the substance. A bare "moved to Resolved" tells a developer
 * nothing they could act on; the resolution summary is the whole reason the transition
 * required one.
 */
export function buildDefectLifecycleComment(input: DefectLifecycleCommentInput): string {
  return [
    `*QAMS defect ${input.defectBusinessId} — ${readable(input.from)} → ${readable(input.to)}*`,
    `By ${escapeWikiMarkup(cap(input.actorName, MAX_DEFECT_FIELD_CHARS))} · ${formatInstant(input.occurredAt, input.timeZone)}`,
    ...(input.notes.length === 0
      ? []
      : [
          "",
          // The label is QAMS's own word and needs no escaping; the value is what a person
          // typed and always does.
          ...input.notes.map(
            (note) => `* *${note.label}:* ${escapeWikiMarkup(cap(note.value, MAX_DEFECT_FIELD_CHARS))}`
          )
        ]),
    ...(input.defectUrl === null ? [] : ["", `[View in QAMS|${input.defectUrl}]`])
  ].join("\n");
}

/**
 * Does reaching this status mean the Jira issue should be moved to a done status?
 *
 * Closed alone. A defect's other states all describe work still in flight, and `RESOLVED` is
 * deliberately not enough: QAMS requires retest evidence or a closure rationale to get from
 * Resolved to Closed (`docs/roles-workflows.md`), which is precisely the check that decides
 * whether the fix actually worked. Transitioning at Resolved would close the Jira issue before
 * anyone had verified anything, and a defect can move from Resolved back to In Progress.
 *
 * Unlike the execution rule, this reads one defect and no siblings: a defect owns its issue
 * outright, so there is no other record whose state could contradict this one.
 */
export function shouldTransitionDefectIssue(status: DefectLifecycleState): boolean {
  return status === DefectLifecycleState.CLOSED;
}
