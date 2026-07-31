import { Prisma } from "@prisma/client";
import { AppError } from "./errors";

/**
 * Makes the optimistic `version` check atomic (`PRODUCTION-READINESS-2026-07-31.md` B1).
 *
 * ## What was wrong
 *
 * Every mutation read the row, compared `version` in application code, and then issued an
 * `UPDATE ... WHERE id = ?`. The compare and the write were separate statements, and the
 * read was not even inside the transaction — so two callers who both read version 1 both
 * passed the check and both wrote. **The second silently overwrote the first**, the row
 * landed at version 3, and no `VERSION_CONFLICT` was ever raised. On a shared test
 * repository, which is the normal working pattern for a QA team, that is routine data loss
 * with nothing to notice it by.
 *
 * The `version` column exists precisely to stop that, so the promise was being made and not
 * kept.
 *
 * ## The fix
 *
 * The expected version goes into the UPDATE's `WHERE`, so the database performs the compare
 * as part of the write. A concurrent writer has already incremented the column, the filter
 * matches no row, and Prisma raises `P2025` — which this module translates into the
 * documented `409 VERSION_CONFLICT`.
 *
 * ## Why the translation is scoped to the update, not global
 *
 * `P2025` means "a record this operation depended on was not found". Mapping it to
 * `VERSION_CONFLICT` inside `asErrorResponse` would be wrong for every *other* thing that
 * raises it — a missing relation on a nested write, for instance, which is a
 * `REFERENCE_NOT_FOUND`, not a conflict. Wrapping only the versioned update keeps the
 * meaning of the translation obvious at the point it is made.
 *
 * The broader Prisma error mapping (`P2002` duplicate business IDs, currently surfacing as
 * 500s) is finding **B2** and remains open; this deliberately does not do it.
 *
 * ## The one ambiguity, stated
 *
 * Callers read the row first, so a `P2025` here means either the version moved or the row
 * was deleted between the read and the write. `409` covers both. Nothing in this system
 * deletes those rows — `docs/data-model.md:16` makes retirement the only preservation path
 * and there are no delete endpoints — so in practice it is always the version.
 */

/** True for Prisma's "required record not found" error. */
export function isRecordNotFound(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";
}

/** The single definition of the conflict this module raises. */
export function versionConflict(): AppError {
  return new AppError(409, "VERSION_CONFLICT", "Record version conflict.", "version");
}

/**
 * Runs a versioned write, converting "matched no row" into `409 VERSION_CONFLICT`.
 *
 * Wrap the whole transaction, not just the `update` call: the audit event and any sibling
 * writes must roll back with it, and a conflict must not leave a half-applied change.
 * Any other error passes through untouched.
 */
export async function withVersionCheck<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (isRecordNotFound(error)) throw versionConflict();
    throw error;
  }
}
