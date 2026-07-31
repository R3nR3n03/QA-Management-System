import type { z } from "zod";
import { AppError } from "../errors";

/**
 * Shared zod-issue -> AppError mapping for the request-shape schemas.
 *
 * Lives beside the schemas rather than in `request.ts` so it stays pure and testable.
 */

/**
 * Derives the `field` reported in the error contract from a single zod issue.
 *
 * `unrecognized_keys` issues carry an empty `path` and name the offending keys in `keys`,
 * so reading `path` alone would lose the field for exactly the mass-assignment case this
 * validation exists to catch.
 */
export function schemaIssueField(issue: z.core.$ZodIssue): string | undefined {
  if (issue.path.length > 0) return issue.path.map(String).join(".");
  if (issue.code === "unrecognized_keys") return issue.keys[0];
  return undefined;
}

/**
 * Maps a zod failure onto the project's single error shape.
 *
 * Reuses the existing `ID_INVALID` / 422 pair used by `requireNonBlank` and
 * `ensureStepSequence`; the contract carries one `field`, so only the first issue is
 * reported.
 */
export function schemaValidationError(error: z.ZodError): AppError {
  const issue = error.issues[0];
  if (!issue) return new AppError(422, "ID_INVALID", "Invalid request body.");
  return new AppError(422, "ID_INVALID", issue.message, schemaIssueField(issue));
}
