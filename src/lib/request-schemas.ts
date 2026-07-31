import { z } from "zod";
import { AppError } from "./errors";

/**
 * Request-shape schemas for the v1 API.
 *
 * These validate the *shape* of a request body at the route boundary only. Business rules,
 * RBAC and lifecycle transitions stay in `src/domain/*`.
 */

/**
 * POST /api/v1/test-cases.
 *
 * `strictObject` is load-bearing: it rejects any key that is not listed below, so a caller
 * cannot smuggle `lifecycleState`, `version`, `reviewReason`, `retirementReason`,
 * `authorUserId` or `id` into the create payload. Without it those keys would be silently
 * ignored rather than reported, which contradicts docs/business-rules-and-validation.md.
 *
 * Deliberately no `.min(1)` on cycle/sprint/release/environment/priority/severity:
 * `createTestCase` permits them blank on create and `submitTestCase` enforces non-blank
 * before review. Requiring blank-ness here would invent policy the docs do not establish.
 */
export const createTestCaseSchema = z.strictObject({
  businessId: z.string().min(1),
  productId: z.string().min(1),
  moduleId: z.string().min(1),
  featureId: z.string().min(1),
  requirementId: z.string().min(1),
  cycle: z.string(),
  sprint: z.string(),
  release: z.string(),
  environment: z.string(),
  priority: z.string(),
  severity: z.string(),
  title: z.string().min(1),
  objective: z.string().min(1),
  expectedResult: z.string().min(1),
  revisesTestCaseId: z.string().min(1).optional()
});

export type CreateTestCaseBody = z.infer<typeof createTestCaseSchema>;

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
 * Reuses the existing `ID_INVALID` / 422 pair used by `requireNonBlank`,
 * `ensureStepSequence` and `parseJson`; the contract carries one `field`, so only the
 * first issue is reported.
 */
export function schemaValidationError(error: z.ZodError): AppError {
  const issue = error.issues[0];
  if (!issue) return new AppError(422, "ID_INVALID", "Invalid request body.");
  return new AppError(422, "ID_INVALID", issue.message, schemaIssueField(issue));
}
