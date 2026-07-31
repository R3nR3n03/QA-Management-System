/**
 * The import's row-classification rules, extracted as pure functions.
 *
 * These decisions ARE the import's contract with
 * `docs/business-rules-and-validation.md` § "Import rules" — which rows are
 * rejected, which are `SKIPPED_UNCHANGED`, and which are `RECONCILIATION_REQUIRED`
 * and therefore left uncommitted. They previously lived inline in `imports.ts`,
 * interleaved with Prisma calls, which meant the file holding all of the risk had no
 * test coverage at all while the parsing module beside it had twenty-five tests
 * (WORKBOOK-IMPORT-AUDIT-2026-07-31.md W3).
 *
 * Nothing here touches Prisma or performs I/O. The caller loads the records, the
 * caller performs the writes; this module only decides. That keeps the ordering of
 * the checks — which is load-bearing, see `decideCatalogueRow` — testable without a
 * database.
 */

import type { ErrorCode } from "@/lib/errors";

export type RowDecision =
  | { kind: "REJECTED"; errorCode: ErrorCode; details: string }
  | { kind: "SKIPPED_UNCHANGED"; recordId: string; details?: string }
  | { kind: "RECONCILIATION_REQUIRED"; recordId: string; details: string }
  | { kind: "CREATE" };

export type ExistingRecord = {
  id: string;
  /** Whether every imported field already matches, compared with `valuesEqual`. */
  unchanged: boolean;
};

export type MissingParent = {
  /** Human label of the parent entity, e.g. "Product". */
  label: string;
  /** The business ID the row referenced. */
  businessId: string;
};

export type CatalogueRowInput = {
  /** Human label of the entity being imported, e.g. "Product". */
  entityLabel: string;
  businessId: string;
  /** The `BUSINESS_ID_PATTERNS` entry for this entity. */
  pattern: RegExp;
  /** The documented format, for the rejection message, e.g. "PROD###". */
  patternLabel: string;
  /** True when an earlier row in the same sheet already claimed this business ID. */
  alreadySeenInSheet: boolean;
  /** Set when the row references a parent that was not found. */
  missingParent?: MissingParent | null;
  /** The persisted record with this business ID, when one exists. */
  existing?: ExistingRecord | null;
};

/**
 * Classify one Product / Module / Feature / Requirement row.
 *
 * THE ORDER IS THE RULE, not an implementation detail:
 *
 * 1. **Malformed business ID** first, because a row whose ID cannot be trusted cannot
 *    meaningfully be compared against anything (`ID_INVALID`).
 * 2. **Duplicate within the sheet** next, so the second occurrence is reported against
 *    its own source row rather than surfacing later as a database constraint error
 *    (`ID_DUPLICATE`).
 * 3. **Unknown parent**, which `docs/excel-source-map.md:34` requires be rejected
 *    "without partial dependent writes" (`REFERENCE_NOT_FOUND`).
 * 4. **Already persisted** — identical values are `SKIPPED_UNCHANGED`, different values
 *    are `RECONCILIATION_REQUIRED` and are NOT written
 *    (`business-rules-and-validation.md:45`).
 * 5. Otherwise create.
 *
 * A row can satisfy several of these at once; the earliest wins, and the tests pin
 * that precedence so a later refactor cannot quietly reorder it.
 */
export function decideCatalogueRow(input: CatalogueRowInput): RowDecision {
  if (!input.pattern.test(input.businessId)) {
    return {
      kind: "REJECTED",
      errorCode: "ID_INVALID",
      details: `${input.entityLabel} ID "${input.businessId}" must match ${input.patternLabel}.`
    };
  }

  if (input.alreadySeenInSheet) {
    return {
      kind: "REJECTED",
      errorCode: "ID_DUPLICATE",
      details: `Duplicate ${input.entityLabel} ID "${input.businessId}" in sheet.`
    };
  }

  if (input.missingParent) {
    return {
      kind: "REJECTED",
      errorCode: "REFERENCE_NOT_FOUND",
      details: `${input.missingParent.label} "${input.missingParent.businessId}" was not found.`
    };
  }

  if (input.existing) {
    return input.existing.unchanged
      ? { kind: "SKIPPED_UNCHANGED", recordId: input.existing.id }
      : {
          kind: "RECONCILIATION_REQUIRED",
          recordId: input.existing.id,
          details: `${input.entityLabel} "${input.businessId}" exists with different values; automatic overwrite is not permitted.`
        };
  }

  return { kind: "CREATE" };
}

/**
 * Classify a Settings row. The Settings sheet has no business IDs and no parents; the
 * only question is whether the (catalogue, value) pair already exists.
 *
 * An INACTIVE existing value is `RECONCILIATION_REQUIRED` rather than a silent
 * reactivation: a QA Lead may have deactivated it deliberately through
 * `PATCH /controlled-values`, and re-importing the workbook must not undo that. This
 * mirrors the same refusal in `prisma/seed.ts`.
 */
export function decideSettingsValue(input: {
  catalogue: string;
  value: string;
  existing?: { id: string; active: boolean } | null;
  /** Set when an earlier row in this same import already created the pair. */
  createdEarlierInRun?: string | null;
}): RowDecision {
  if (input.existing) {
    return input.existing.active
      ? {
          kind: "SKIPPED_UNCHANGED",
          recordId: input.existing.id,
          details: `${input.catalogue} value already configured.`
        }
      : {
          kind: "RECONCILIATION_REQUIRED",
          recordId: input.existing.id,
          details: `${input.catalogue} value "${input.value}" exists but is inactive; reactivation requires QA Lead reconciliation.`
        };
  }

  if (input.createdEarlierInRun) {
    return {
      kind: "SKIPPED_UNCHANGED",
      recordId: input.createdEarlierInRun,
      details: "Duplicate of a value created earlier in this import."
    };
  }

  return { kind: "CREATE" };
}
