/**
 * Translation layer: stable API error codes -> sentences a person can act on.
 *
 * `src/lib/errors.ts` owns the machine vocabulary and must stay exactly as it is —
 * the codes are the contract the acceptance scenarios in
 * `docs/testing-and-acceptance.md` assert against. This module is the *only*
 * place that turns one into user-facing prose, so the wording can be reviewed and
 * changed in one file rather than hunted across screens.
 *
 * PROPOSAL, NOT APPROVED POLICY. `docs/` specifies no user-facing copy anywhere.
 * The wording below is proposed for QA Lead review; it states no rule that the
 * knowledge base does not already establish, and it invents no threshold, status
 * or permission. See IMPLEMENTATION-AUDIT-2026-07-31.md section 5.10.
 *
 * This module must stay pure — no imports from `./db`, no `next/*`, no I/O — so it
 * is unit-testable without a database. That is deliberate.
 */

import type { ErrorCode } from "@/lib/errors";

export type ErrorCopy = {
  /** One short sentence naming what happened. Never starts with "Error". */
  title: string;
  /** What to do next. Empty string when the title is genuinely self-contained. */
  detail: string;
  /**
   * True when this is not a failure at all — the system is reporting that the
   * knowledge base does not establish something. Rendered calmly, not in red.
   * `docs/business-rules-and-validation.md:38`.
   */
  advisory?: boolean;
};

/**
 * Field-specific overrides, keyed `CODE:field`. Checked before the generic table
 * so a message can name the actual thing on screen. Business-ID formats come from
 * `BUSINESS_ID_PATTERNS` in `src/lib/business-ids.ts` — keep them in step.
 */
const BY_FIELD: Record<string, ErrorCopy> = {
  "ID_INVALID:businessId": {
    title: "That ID isn't in the expected format.",
    detail: "Product IDs look like PROD001, test cases like TC-CHECKOUT-0042, defects like BUG-0007."
  },
  "ID_INVALID:steps": {
    title: "Step numbers have to run 1, 2, 3 with no gaps.",
    detail: "Renumber the steps so they're consecutive, then save again."
  },
  "ID_DUPLICATE:businessId": {
    title: "That ID is already taken.",
    detail: "Open the existing record, or choose a different ID."
  },
  "REFERENCE_NOT_FOUND:defectId": {
    title: "A failed run needs a defect against the same test case.",
    detail: "Raise one here, or pick an existing defect that already references this test case."
  },
  "REFERENCE_INACTIVE:testerId": {
    title: "That tester's account is inactive.",
    detail: "Assign someone else, or ask a QA Lead to reactivate them."
  },
  "CONTROLLED_VALUE_INVALID:priority": {
    title: "That isn't a configured priority.",
    detail: "Choose one of the active values. A QA Lead manages this list."
  },
  "CONTROLLED_VALUE_INVALID:severity": {
    title: "That isn't a configured severity.",
    detail: "Choose one of the active values. A QA Lead manages this list."
  },
  "ID_INVALID:blockReason": {
    title: "A blocked run needs a reason.",
    detail: "Say what stopped the run so whoever picks it up knows where to start."
  },
  "ID_INVALID:actualResult": {
    title: "Record what actually happened before finalizing.",
    detail: "This is the evidence the result rests on, so it can't be left blank."
  },
  "ID_INVALID:file": {
    // Covers both "no file attached" and "file too large". The service message
    // already names the limit; this is the fallback wording when it doesn't.
    title: "That workbook couldn't be accepted.",
    detail: "Attach a single .xlsx file within the size limit for this endpoint."
  }
};

const BY_CODE: Record<ErrorCode, ErrorCopy> = {
  ID_INVALID: {
    title: "Something in the form needs another look.",
    detail: "The highlighted field is either empty or not in the expected format."
  },
  ID_DUPLICATE: {
    title: "That ID already exists.",
    detail: "Open the existing record, or choose a different ID."
  },
  REFERENCE_NOT_FOUND: {
    title: "That record no longer exists.",
    detail: "It may have changed since this page loaded. Reload to see what's there now."
  },
  REFERENCE_INACTIVE: {
    title: "That record is inactive.",
    detail: "Pick an active one, or ask a QA Lead to reactivate it."
  },
  HIERARCHY_MISMATCH: {
    title: "Those records don't belong to the same product hierarchy.",
    detail: "A requirement has to sit under the feature you picked, which sits under the module, which sits under the product."
  },
  CONTROLLED_VALUE_INVALID: {
    title: "That value isn't configured.",
    detail: "Choose one of the active values. A QA Lead manages these lists."
  },
  VERSION_CONFLICT: {
    title: "Someone else changed this while you were working.",
    detail: "Nothing you typed has been lost. Compare the two versions and choose which to keep."
  },
  ROW_INCOMPLETE: {
    title: "A row in the workbook is missing required values.",
    detail: "Fix it at source and import again. Nothing from that row was saved."
  },
  RECONCILIATION_REQUIRED: {
    title: "That ID already exists with different values.",
    detail: "Nothing was overwritten. A QA Lead decides which version stands."
  },
  POLICY_NOT_DEFINED: {
    title: "This isn't something QAMS decides.",
    detail: "The knowledge base defines no threshold here, so the evidence is shown and the judgement is yours to record.",
    advisory: true
  },
  FORBIDDEN_TRANSITION: {
    title: "That isn't a step this record can take right now.",
    detail: "Its current state doesn't allow it. The lifecycle on the page shows what comes next."
  },
  UNAUTHORIZED: {
    title: "This one isn't yours to do.",
    detail: "Ask someone with the right role to take it on."
  },
  INTERNAL_ERROR: {
    title: "Something broke on our side.",
    detail: "Nothing was saved. Try again, and quote the reference below if it keeps happening."
  }
};

/**
 * Resolves the friendliest copy available: field-specific first, then the code's
 * general wording. An unrecognised code falls back to INTERNAL_ERROR rather than
 * rendering a raw identifier — a user should never see `HIERARCHY_MISMATCH`.
 */
export function errorCopy(code: string, field?: string | null): ErrorCopy {
  if (field) {
    const specific = BY_FIELD[`${code}:${field}`];
    if (specific) return specific;
  }
  return BY_CODE[code as ErrorCode] ?? BY_CODE.INTERNAL_ERROR;
}

/** Every code has copy. Used by the test to prove none was forgotten. */
export function coveredCodes(): string[] {
  return Object.keys(BY_CODE).sort();
}
