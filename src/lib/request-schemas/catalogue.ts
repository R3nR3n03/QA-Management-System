import { z } from "zod";

/**
 * Request-shape schemas for the product / module / feature / requirement routes.
 *
 * Every field mirrors `src/domain/catalogue.ts` exactly; the trailing comment names the line
 * that justifies the strictness. Reference ids (`productId`, `moduleId`, `featureId`) get a
 * plain `z.string()` because no domain function blank-guards them — a blank id simply fails
 * the `findUnique` and yields today's 404/REFERENCE_NOT_FOUND.
 *
 * Business-id *format* (`PROD###`, `MOD###`, …) stays in `ensureBusinessIdFormat`; duplicate
 * detection stays in the domain. Neither is duplicated here.
 */

/** POST /api/v1/products -> `createProduct`. */
export const createProductSchema = z.strictObject({
  businessId: z.string().min(1), // requireNonBlank — catalogue.ts:20
  name: z.string().min(1), // requireNonBlank — catalogue.ts:21
  versionTag: z.string().min(1), // requireNonBlank — catalogue.ts:22
  status: z.string().min(1) // requireNonBlank — catalogue.ts:23
});

/** PATCH /api/v1/products/{id} -> `updateProduct`. */
export const updateProductSchema = z.strictObject({
  version: z.number().optional(), // ensureVersion tolerates undefined (409) — catalogue.ts:67
  name: z.string().min(1).optional(), // requireNonBlankIfProvided — catalogue.ts:62
  versionTag: z.string().min(1).optional(), // requireNonBlankIfProvided — catalogue.ts:63
  status: z.string().min(1).optional() // requireNonBlankIfProvided — catalogue.ts:64
});

/** POST /api/v1/modules -> `createModule`. */
export const createModuleSchema = z.strictObject({
  businessId: z.string().min(1), // requireNonBlank — catalogue.ts:101
  name: z.string().min(1), // requireNonBlank — catalogue.ts:102
  productId: z.string() // no blank guard; unresolved id 404s — catalogue.ts:105-106
});

/** PATCH /api/v1/modules/{id} -> `updateModule`. */
export const updateModuleSchema = z.strictObject({
  version: z.number().optional(), // ensureVersion tolerates undefined (409) — catalogue.ts:138
  name: z.string().min(1).optional() // requireNonBlankIfProvided — catalogue.ts:135
});

/** POST /api/v1/features -> `createFeature`. */
export const createFeatureSchema = z.strictObject({
  businessId: z.string().min(1), // requireNonBlank — catalogue.ts:166
  name: z.string().min(1), // requireNonBlank — catalogue.ts:167
  moduleId: z.string() // no blank guard; unresolved id 404s — catalogue.ts:170-171
});

/** PATCH /api/v1/features/{id} -> `updateFeature`. */
export const updateFeatureSchema = z.strictObject({
  version: z.number().optional(), // ensureVersion tolerates undefined (409) — catalogue.ts:203
  name: z.string().min(1).optional() // requireNonBlankIfProvided — catalogue.ts:200
});

/** POST /api/v1/requirements -> `createRequirement`. */
export const createRequirementSchema = z.strictObject({
  businessId: z.string().min(1), // requireNonBlank — catalogue.ts:231
  statement: z.string().min(1), // requireNonBlank — catalogue.ts:232
  featureId: z.string() // no blank guard; unresolved id 404s — catalogue.ts:235-236
});

/** PATCH /api/v1/requirements/{id} -> `updateRequirement`. */
export const updateRequirementSchema = z.strictObject({
  version: z.number().optional(), // ensureVersion tolerates undefined (409) — catalogue.ts:272
  statement: z.string().min(1).optional() // requireNonBlankIfProvided — catalogue.ts:269
});
