import { z } from "zod";

/**
 * Request-shape schemas for the test-case routes.
 *
 * Each field mirrors what `src/domain/test-cases.ts` actually tolerates, and carries the
 * domain line that justifies its strictness. Anything stricter than the domain body would
 * invent policy the knowledge base does not establish; anything looser would let an
 * unvalidated value reach Prisma.
 *
 * Business rules (lifecycle gates, step-count-before-review, controlled-value membership)
 * stay in the domain layer — no `.refine()` here.
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
 *
 * NOTE: the four hierarchy ids carry `.min(1)`, which the schemas added later deliberately
 * do NOT propagate (they use plain `z.string()`, matching their domain functions, which do
 * not blank-guard reference ids). This schema is shipped behaviour and is left untouched;
 * see the run plan, judgment call J4.
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

/** PATCH /api/v1/test-cases/{id} -> `updateTestCaseDraft`. */
export const updateTestCaseDraftSchema = z.strictObject({
  version: z.number().optional(), // ensureVersion tolerates undefined (409) — test-cases.ts:180
  cycle: z.string().min(1).optional(), // requireNonBlankIfProvided — test-cases.ts:167
  sprint: z.string().min(1).optional(), // requireNonBlankIfProvided — test-cases.ts:168
  release: z.string().min(1).optional(), // requireNonBlankIfProvided — test-cases.ts:169
  environment: z.string().min(1).optional(), // requireNonBlankIfProvided — test-cases.ts:170
  title: z.string().min(1).optional(), // requireNonBlankIfProvided — test-cases.ts:171
  objective: z.string().min(1).optional(), // requireNonBlankIfProvided — test-cases.ts:172
  expectedResult: z.string().min(1).optional(), // requireNonBlankIfProvided — test-cases.ts:173
  priority: z.string().optional(), // blank clears the value, skips the catalogue check — test-cases.ts:182,193
  severity: z.string().optional() // blank clears the value, skips the catalogue check — test-cases.ts:183,194
});

/**
 * PUT /api/v1/test-cases/{id}/steps -> `replaceSteps`.
 *
 * `steps` is required: omitting it currently reaches `ensureStepSequence` as `undefined` and
 * throws a TypeError (500). The array is deliberately NOT `.min(1)` — an empty array wipes
 * all steps today, and docs/business-rules-and-validation.md:19 requires at least one step
 * *before review* (`submitTestCase` enforces it at test-cases.ts:275), not at draft.
 */
export const replaceStepsSchema = z.strictObject({
  version: z.number().optional(), // ensureVersion tolerates undefined (409) — test-cases.ts:227
  steps: z.array(
    z.strictObject({
      sequence: z.number(), // consecutiveness checked by ensureStepSequence — test-cases.ts:228
      action: z.string().min(1), // requireNonBlank — test-cases.ts:230
      expectedResult: z.string().min(1) // requireNonBlank — test-cases.ts:231
    })
  )
});

/** POST /api/v1/test-cases/{id}/submit -> `submitTestCase`. */
export const submitTestCaseSchema = z.strictObject({
  version: z.number().optional() // ensureVersion tolerates undefined (409) — test-cases.ts:274
});

/** POST /api/v1/test-cases/{id}/approve -> `approveTestCase`. */
export const approveTestCaseSchema = z.strictObject({
  version: z.number().optional() // ensureVersion tolerates undefined (409) — test-cases.ts:317
});

/** POST /api/v1/test-cases/{id}/return-to-draft -> `returnTestCaseToDraft`. */
export const returnTestCaseToDraftSchema = z.strictObject({
  version: z.number().optional(), // ensureVersion tolerates undefined (409) — test-cases.ts:352
  reviewReason: z.string().min(1) // requireNonBlank — test-cases.ts:346
});

/** POST /api/v1/test-cases/{id}/retire -> `retireTestCase`. */
export const retireTestCaseSchema = z.strictObject({
  version: z.number().optional(), // ensureVersion tolerates undefined (409) — test-cases.ts:388
  retirementReason: z.string().min(1) // requireNonBlank — test-cases.ts:382
});
