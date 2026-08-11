import { ExecutionOutcome } from "@prisma/client";
import { z } from "zod";
import { EXECUTION_PURPOSE_MAX_LENGTH } from "@/lib/field-limits";

/** Request-shape schemas for the execution routes, mirroring `src/domain/executions.ts`. */

/**
 * POST /api/v1/executions -> `createExecution`.
 *
 * An execution covers one or more Approved cases selected together at planning
 * (`docs/business-rules-and-validation.md:27`), so `testCaseIds` is a non-empty array
 * with no duplicates. Both bounds are re-checked in the domain (executions.ts:31-36)
 * because server actions call it without passing through this schema.
 */
export const createExecutionSchema = z.strictObject({
  // Optional: when absent the server allocates the next free EXE-#### (docs/api-and-security.md:5).
  // Still non-blank when present — a blank supplied ID 422s in the domain too.
  businessId: z.string().min(1).optional(),
  testCaseIds: z
    .array(z.string()) // no blank guard per id; an unresolved id 404s — executions.ts:42-44
    .min(1) // non-empty — executions.ts:31-33
    .refine((ids) => new Set(ids).size === ids.length, {
      message: "Each test case may be selected only once."
    }), // duplicates 422 — executions.ts:34-36
  testerId: z.string(), // no blank guard; unresolved id 422s REFERENCE_INACTIVE — executions.ts:50-53
  // Required, unlike every other free-text field on a create: the purpose is the headline
  // every row of `/executions` and `/my-work` is scanned by, and an optional one would be
  // blank exactly where the lists are longest. Both bounds are re-checked in the domain,
  // which is where the rule lives (`docs/business-rules-and-validation.md`).
  //
  // `.trim()` BEFORE the bounds, not after: the documented rule measures the trimmed value,
  // because that is what gets stored. Without it this schema and the domain disagree about
  // the same request — a padded 119-character purpose the domain accepts would be refused
  // here first, with a shape error instead of ID_INVALID naming the field.
  purpose: z.string().trim().min(1).max(EXECUTION_PURPOSE_MAX_LENGTH),
  // Optional, and only shape-checked in the domain (`normalizeJiraIssueKey`): a malformed
  // key 422s ID_INVALID, a blank one reads as "no Jira task", and a well-formed key naming a
  // nonexistent issue is accepted on purpose so Jira can never block planning.
  jiraIssueKey: z.string().nullish()
});

/**
 * PATCH /api/v1/executions/{id} -> `updateExecution` (tester reassignment).
 *
 * The only mutable field on an execution outside its lifecycle transitions is the
 * assigned tester, and only while Planned — the state rule lives in the domain.
 * `strictObject` blocks smuggled `state`, `result` and `testCaseIds`; a run is never
 * repointed at different cases (rerun work creates a new execution).
 */
export const updateExecutionSchema = z.strictObject({
  testerId: z.string(), // no blank guard; unresolved id 422s REFERENCE_INACTIVE like createExecution
  // Absent means "leave the purpose alone". Deliberately `optional` and not `nullish` like
  // the sibling below: a purpose is required, so unlike a Jira link there is no such thing
  // as clearing one. The Planned-only window is a business rule and lives in the domain.
  purpose: z.string().trim().min(1).max(EXECUTION_PURPOSE_MAX_LENGTH).optional(),
  version: z.number().optional(), // ensureVersion tolerates undefined (409) — executions.ts:109
  // Absent means "leave the key alone"; explicit null clears it. Changing it after the run
  // leaves Planned is 422 FORBIDDEN_TRANSITION (`ensureIssueKeyMutable`), on the same rule
  // that freezes the tester.
  jiraIssueKey: z.string().nullish()
});

/** POST /api/v1/executions/{id}/start -> `startExecution`. */
export const startExecutionSchema = z.strictObject({
  version: z.number().optional() // ensureVersion tolerates undefined (409) — executions.ts:146
});

/**
 * POST /api/v1/executions/{id}/finalize -> `finalizeExecution`.
 *
 * All per-case results arrive in this one request — no incremental recording, no
 * partial finalize. `results` is a non-empty array of strict per-case entries; whether
 * it covers the execution's case set exactly once is a business rule checked against
 * the database at executions.ts:225-238, not shape, so it is not encoded here.
 *
 * Each `result` must be a real `ExecutionOutcome`: the domain compares it against the
 * enum at :246/:249/:252 and then writes it straight to an enum column, so an arbitrary
 * string would reach Prisma and fail there as a 500.
 *
 * The conditional per-case rules — Blocked requires `blockReason`, Fail requires a
 * same-case defect, Pass must not create one — stay at executions.ts:246-254. They are
 * business rules, not shape, so none of the fields below is conditionally required here.
 *
 * `createDefect.priority` / `.severity` are optional, matching the sibling `POST /defects`
 * path (defects.ts:43-44) and the `?.` guards the domain already applies at :260/:263.
 * Requiring them would forbid via finalize what direct defect creation permits.
 */
export const finalizeExecutionSchema = z.strictObject({
  version: z.number().optional(), // ensureVersion tolerates undefined (409) — executions.ts:219
  results: z
    .array(
      z.strictObject({
        testCaseId: z.string(), // membership in the covered set 422s — executions.ts:227-233
        result: z.enum(ExecutionOutcome), // Prisma enum column — executions.ts:246,249,252
        actualResult: z.string().min(1), // requireNonBlank per case — executions.ts:244
        blockReason: z.string().optional(), // required only for BLOCKED — executions.ts:246-248
        defectId: z.string().optional(), // no blank guard; mismatched id 422s — executions.ts:303-308
        createDefect: z
          .strictObject({
            // Optional: an ID-less entry gets the next free BUG-#### allocated in the
            // finalize transaction; several ID-less entries get distinct numbers.
            businessId: z.string().min(1).optional(),
            summary: z.string().min(1), // requireNonBlank — executions.ts:258
            priority: z.string().optional(), // blank tolerated, persisted as "" — executions.ts:260,293
            severity: z.string().optional() // blank tolerated, persisted as "" — executions.ts:263,294
          })
          .optional() // absent unless this case is raising a defect — executions.ts:249-250,256
      })
    )
    .min(1) // an empty list can never cover the case set — executions.ts:236-238
});
