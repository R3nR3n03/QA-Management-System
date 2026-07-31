import { Prisma } from "@prisma/client";
import type { ErrorCode } from "./errors";

/**
 * Translates database constraint violations into the documented error contract
 * (`PRODUCTION-READINESS-2026-07-31.md` B2).
 *
 * ## What was wrong
 *
 * `asErrorResponse` had no branch for Prisma errors, so **every** constraint violation
 * became `500 INTERNAL_ERROR`. `docs/architecture.md:46` deliberately designs the database
 * as the second line of defence — "Enforce unique business IDs and foreign keys in
 * PostgreSQL **in addition to** service validation" — and the constraints do fire correctly.
 * The mapping simply threw the information away. A concurrent duplicate business ID returned
 * 500 where `docs/business-rules-and-validation.md:5` documents 409.
 *
 * ## Messages are fixed strings, never Prisma's
 *
 * Prisma's `message` embeds the full failing invocation, including the data being written.
 * Returning it would leak SQL detail and record contents to the caller, which
 * `docs/api-and-security.md:33` forbids ("Do not expose stack traces, SQL details,
 * authorization rules, or internal identifiers"). The structured log still receives the
 * original error, so nothing is lost for diagnosis — it just is not sent to the client.
 *
 * ## Returns a descriptor, not an `AppError`
 *
 * So this module can be imported by `errors.ts` without a runtime import cycle: the only
 * thing it needs back is the `ErrorCode` type, and a type-only import is erased.
 */
export type MappedPrismaError = {
  status: number;
  code: ErrorCode;
  message: string;
  field?: string;
};

/**
 * A usable field name from `meta.target` on a unique violation.
 *
 * Postgres reports this as an array of column names (`["businessId"]`, or
 * `["catalogue","value"]` for a compound key). Some drivers report the raw index name
 * instead (`User_email_key`), which is an internal identifier and is deliberately NOT
 * surfaced — `undefined` is better than an index name in a `field` the client is meant to
 * map to a form input.
 */
export function uniqueViolationField(meta: unknown): string | undefined {
  if (!meta || typeof meta !== "object") return undefined;
  const target = (meta as { target?: unknown }).target;

  if (Array.isArray(target)) {
    const names = target.filter((t): t is string => typeof t === "string");
    return names.length > 0 ? names.join(", ") : undefined;
  }
  // A bare string here is usually the index name, not a column. Suppress it.
  return undefined;
}

/**
 * Maps a known Prisma request error, or returns null to leave it as a 500.
 *
 * Deliberately narrow. An unmapped code keeps its `500 INTERNAL_ERROR`, which is the honest
 * answer for something nobody has reasoned about — and it is now visible, because the
 * structured logging added in C1 records the original error and its Prisma code.
 */
export function mapPrismaError(error: unknown): MappedPrismaError | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return null;

  switch (error.code) {
    // Unique constraint. The service pre-checks for duplicates, so reaching this means two
    // callers raced between the check and the insert -- exactly the case
    // `business-rules-and-validation.md:5` documents as 409.
    case "P2002":
      return {
        status: 409,
        code: "ID_DUPLICATE",
        message: "A record with that identifier already exists.",
        field: uniqueViolationField(error.meta)
      };

    // Foreign key constraint. Something the record REFERENCES does not exist, which the
    // validation table maps to REFERENCE_NOT_FOUND at 422 -- distinct from the 404 below,
    // which is the record the caller actually asked for.
    case "P2003":
      return {
        status: 422,
        code: "REFERENCE_NOT_FOUND",
        message: "A referenced record does not exist."
      };

    // The record an update or delete targets was not found. 404, per
    // `business-rules-and-validation.md:5` ("missing records return 404").
    //
    // NOT mapped to VERSION_CONFLICT, deliberately. Versioned writes are wrapped in
    // `withVersionCheck` (see `optimistic-lock.ts`), which converts their P2025 to 409
    // before it ever reaches here — so a P2025 arriving at this point is something else,
    // most likely a nested relation, and calling that a version conflict would send whoever
    // debugs it in the wrong direction.
    case "P2025":
      return {
        status: 404,
        code: "REFERENCE_NOT_FOUND",
        message: "The requested record was not found."
      };

    default:
      return null;
  }
}
