import { AppError } from "./errors";

export function requireNonBlank(value: string | null | undefined, field: string, message: string) {
  if (!value || !value.trim()) {
    throw new AppError(422, "ID_INVALID", message, field);
  }
}

export function requireNonBlankIfProvided(value: string | undefined, field: string, message: string) {
  if (value !== undefined) requireNonBlank(value, field, message);
}

/**
 * Caps a free-text field's length, measured on the trimmed value because that is what is
 * stored.
 *
 * The system's only length rule, and deliberately not a general habit: every other free-text
 * field here (`objective`, `expectedResult`, `actualResult`, a defect's `summary`) is read on
 * a detail page, where length costs the reader nothing. An execution's purpose is the
 * HEADLINE of every row on `/executions` and `/my-work`, so an unbounded one wrecks the row
 * for every other run on the page — the rule exists for that, and belongs in the domain
 * rather than in a stylesheet because "one line" is a documented business rule
 * (`docs/business-rules-and-validation.md`).
 *
 * `ID_INVALID` for the same reason a too-short password uses it (`docs/testing-and-acceptance.md`):
 * it is this system's stable code for "this text value is not acceptable", and `field` plus
 * `message` say which text and why. Absence is not this function's business — pair it with
 * `requireNonBlank` when the field is required.
 */
export function requireMaxLength(
  value: string | null | undefined,
  max: number,
  field: string,
  message: string
) {
  if (value && value.trim().length > max) {
    throw new AppError(422, "ID_INVALID", message, field);
  }
}

/**
 * Checks the caller's optimistic `version` against the row that was just read, and
 * **returns it narrowed to a number** so the caller can put it in the UPDATE's `WHERE`.
 *
 * That return value is the point. This check alone is not sufficient and never was: the
 * read happens before the write, so two callers can both read version 1, both pass here,
 * and both write — the second silently overwriting the first with no conflict raised
 * (`PRODUCTION-READINESS-2026-07-31.md` B1). The only check that actually holds is the one
 * the database performs as part of the write, and it needs this value to perform it.
 *
 * So this is now the *fast, friendly* half of a two-part check: it produces a clear 409
 * without a round trip in the common case, and it is the only thing that catches an
 * **omitted** version — `where: { version: undefined }` is silently ignored by Prisma
 * rather than matching nothing, which would have turned a missing version into a
 * successful unconditional write. `docs/business-rules-and-validation.md:15` maps the
 * missing-version case to `VERSION_CONFLICT`, so that behaviour is deliberate and load-
 * bearing, not an accident.
 */
export function ensureVersion(actual: number, expected: number | undefined): number {
  if (expected === undefined || actual !== expected) {
    throw new AppError(409, "VERSION_CONFLICT", "Record version conflict.", "version");
  }
  return expected;
}

export function ensureStepSequence(steps: Array<{ sequence: number }>) {
  const sorted = [...steps].sort((a, b) => a.sequence - b.sequence);
  for (let i = 0; i < sorted.length; i += 1) {
    if (sorted[i].sequence !== i + 1) {
      throw new AppError(422, "ID_INVALID", "Step sequence must be consecutive 1..n.", "steps");
    }
  }
}
