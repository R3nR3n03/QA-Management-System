import { ExecutionOutcome } from "@prisma/client";
import { z } from "zod";

/** Request-shape schemas for the execution routes, mirroring `src/domain/executions.ts`. */

/** POST /api/v1/executions -> `createExecution`. */
export const createExecutionSchema = z.strictObject({
  businessId: z.string().min(1), // requireNonBlank — executions.ts:22
  testCaseId: z.string(), // no blank guard; unresolved id 404s — executions.ts:25-26
  testerId: z.string() // no blank guard; unresolved id 422s REFERENCE_INACTIVE — executions.ts:31-34
});

/**
 * PATCH /api/v1/executions/{id} -> `updateExecution` (tester reassignment).
 *
 * The only mutable field on an execution outside its lifecycle transitions is the
 * assigned tester, and only while Planned — the state rule lives in the domain.
 * `strictObject` blocks smuggled `state`, `result` and `testCaseId`; a run is never
 * repointed at a different case (rerun work creates a new execution).
 */
export const updateExecutionSchema = z.strictObject({
  testerId: z.string(), // no blank guard; unresolved id 422s REFERENCE_INACTIVE like createExecution
  version: z.number().optional() // ensureVersion tolerates undefined (409)
});

/** POST /api/v1/executions/{id}/start -> `startExecution`. */
export const startExecutionSchema = z.strictObject({
  version: z.number().optional() // ensureVersion tolerates undefined (409) — executions.ts:77
});

/**
 * POST /api/v1/executions/{id}/finalize -> `finalizeExecution`.
 *
 * `result` must be a real `ExecutionOutcome`: the domain compares it against the enum at
 * :128/:131/:134 and then writes it straight to an enum column, so an arbitrary string
 * currently reaches Prisma and fails there as a 500.
 *
 * The conditional rules — Blocked requires `blockReason`, Fail requires a defect, Pass must
 * not create one — stay at executions.ts:128-136. They are business rules, not shape, so none
 * of the fields below is conditionally required here.
 *
 * `createDefect.priority` / `.severity` are optional, matching the sibling `POST /defects`
 * path (defects.ts:43-44) and the `?.` guards the domain already applies at :142/:145.
 * Requiring them would forbid via finalize what direct defect creation permits.
 */
export const finalizeExecutionSchema = z.strictObject({
  version: z.number().optional(), // ensureVersion tolerates undefined (409) — executions.ts:125
  result: z.enum(ExecutionOutcome), // Prisma enum column — executions.ts:128,131,134
  actualResult: z.string().min(1), // requireNonBlank — executions.ts:118
  blockReason: z.string().optional(), // required only for BLOCKED — executions.ts:128-130
  defectId: z.string().optional(), // no blank guard; mismatched id 422s — executions.ts:172-176
  createDefect: z
    .strictObject({
      businessId: z.string().min(1), // requireNonBlank — executions.ts:139
      summary: z.string().min(1), // requireNonBlank — executions.ts:140
      priority: z.string().optional(), // blank tolerated, persisted as "" — executions.ts:142,163
      severity: z.string().optional() // blank tolerated, persisted as "" — executions.ts:145,164
    })
    .optional() // absent unless the tester is raising a defect — executions.ts:131,138
});
