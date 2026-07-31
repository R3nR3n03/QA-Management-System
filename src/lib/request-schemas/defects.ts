import { DefectLifecycleState } from "@prisma/client";
import { z } from "zod";

/**
 * Request-shape schemas for the defect routes, mirroring `src/domain/defects.ts`.
 *
 * `priority` / `severity` are deliberately optional and blank-tolerant on both write paths:
 * `createDefect` persists `input.priority?.trim() ?? ""` and only consults the controlled-value
 * catalogue when the value is non-blank. The inline cast these schemas replace declared them
 * *required*, which was stricter than the service and would have rejected bodies that work
 * today. docs/business-rules-and-validation.md:30 makes the same call: new defects may omit
 * priority/severity, triaged defects require them (enforced at defects.ts:135-136).
 */

/** POST /api/v1/defects -> `createDefect`. */
export const createDefectSchema = z.strictObject({
  businessId: z.string().min(1), // requireNonBlank — defects.ts:22
  testCaseId: z.string(), // no blank guard; unresolved id 404s — defects.ts:26-27
  summary: z.string().min(1), // requireNonBlank — defects.ts:23
  priority: z.string().optional(), // blank tolerated, persisted as "" — defects.ts:29,43
  severity: z.string().optional() // blank tolerated, persisted as "" — defects.ts:30,44
});

/** PATCH /api/v1/defects/{id} -> `updateDefectDetails`. */
export const updateDefectDetailsSchema = z.strictObject({
  version: z.number().optional(), // ensureVersion tolerates undefined (409) — defects.ts:74
  summary: z.string().min(1).optional(), // requireNonBlankIfProvided — defects.ts:67
  priority: z.string().optional(), // blank clears the value, skips the catalogue check — defects.ts:76,84
  severity: z.string().optional() // blank clears the value, skips the catalogue check — defects.ts:77,85
});

/**
 * POST /api/v1/defects/{id}/transition -> `transitionDefect`.
 *
 * Every reason/evidence field is unconditionally optional here. Which of them is *required*
 * depends on the target status and the defect's current status, and that conditional logic is
 * a business rule living at defects.ts:150-174 — expressing it as a `.refine()` would move
 * policy out of the domain layer and duplicate it.
 *
 * `reopenReason` is accepted even though the domain currently reads it only for validation and
 * never persists it (audit §3.4, out of scope): dropping it from the schema would turn today's
 * successful reopen into a 422.
 */
export const transitionDefectSchema = z.strictObject({
  version: z.number().optional(), // ensureVersion tolerates undefined (409) — defects.ts:127
  targetStatus: z.enum(DefectLifecycleState), // Prisma enum column; transition table — defects.ts:129
  investigationOwnerId: z.string().optional(), // required only for TRIAGED -> IN_PROGRESS — defects.ts:150-156
  resolutionSummary: z.string().optional(), // required only for RESOLVED — defects.ts:158-160
  retestEvidenceRef: z.string().optional(), // one of two required only for CLOSED — defects.ts:162-170
  closureRationale: z.string().optional(), // one of two required only for CLOSED — defects.ts:162-170
  reopenReason: z.string().optional() // required only for RESOLVED -> IN_PROGRESS — defects.ts:172-174
});
