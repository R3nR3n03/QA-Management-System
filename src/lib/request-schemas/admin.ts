import { QamsRole } from "@prisma/client";
import { z } from "zod";
import {
  CATALOGUE_PRIORITY,
  CATALOGUE_RESULT,
  CATALOGUE_SEVERITY
} from "@/lib/controlled-value-catalogues";

/** Request-shape schemas for the administration routes, mirroring `src/domain/admin.ts`. */

/**
 * PATCH /api/v1/controlled-values -> `updateControlledValue`.
 *
 * The only write route that takes its target id from the *body* rather than the path, so `id`
 * is listed here. It gets no `.min(1)`: the domain does not blank-guard it and an unresolved
 * id already 404s.
 *
 * `active` must be a real boolean — the domain writes it straight to a boolean column, so a
 * string today reaches Prisma and fails there as a 500.
 *
 * `strictObject` also blocks a caller smuggling `actorId` / `requestId` into the payload; both
 * are server-supplied from the authenticated session.
 */
export const updateControlledValueSchema = z.strictObject({
  id: z.string(), // no blank guard; unresolved id 404s — admin.ts:17-18
  active: z.boolean(), // boolean column — admin.ts:26
  version: z.number().optional() // ensureVersion tolerates undefined (409) — admin.ts:19
});

/**
 * PATCH /api/v1/users/{id}/role -> `updateUserRole`.
 *
 * `role` must be a real `QamsRole`; an arbitrary string currently reaches the enum column and
 * fails at Prisma as a 500. `strictObject` blocks smuggled `actorId` / `requestId`.
 */
export const updateUserRoleSchema = z.strictObject({
  role: z.enum(QamsRole), // Prisma enum column — admin.ts:53
  version: z.number().optional() // ensureVersion tolerates undefined (409) — admin.ts:48
});

/**
 * POST /api/v1/users -> `createUser`.
 *
 * Mirrors the domain's tolerance: blank email/displayName/password are the domain's own
 * `requireNonBlank` 422s, so no `.min(1)` here; the 8-character password floor and the
 * duplicate-email 409 also live in the service. `strictObject` blocks smuggled fields —
 * in particular `passwordHash`, `active`, and the audit actor fields.
 */
export const createUserSchema = z.strictObject({
  email: z.string(), // blankness + normalization in the domain — admin.ts createUser
  displayName: z.string(),
  role: z.enum(QamsRole), // Prisma enum column
  password: z.string() // length floor enforced in the domain
});

/**
 * PATCH /api/v1/users/{id} (profile branch) -> `updateUserProfile`.
 *
 * Both fields optional but at least one must be present — an empty patch is a caller
 * mistake, refused at the boundary before it can reach the domain's own no-op guard.
 * Blankness and email normalization stay in the domain, mirroring `createUser`.
 * `strictObject` blocks smuggled `role`, `active` and `passwordHash` — role changes go
 * through `PATCH /users/{id}/role`, activation through the `active` branch below.
 */
export const updateUserProfileSchema = z
  .strictObject({
    displayName: z.string().optional(), // blankness in the domain — admin.ts updateUserProfile
    email: z.string().optional(), // normalization + duplicate 409 in the domain
    version: z.number().optional() // ensureVersion tolerates undefined (409)
  })
  .refine((body) => body.displayName !== undefined || body.email !== undefined, {
    message: "Provide displayName or email."
  });

/**
 * PATCH /api/v1/users/{id} (activation branch) -> `setUserActive`.
 *
 * `active` must be a real boolean — the domain writes it to a boolean column. Strictness
 * means a body mixing activation with profile fields matches neither branch of
 * `patchUserSchema` and is refused at the boundary, keeping one domain call per request.
 */
export const setUserActiveSchema = z.strictObject({
  active: z.boolean(), // boolean column — admin.ts setUserActive
  version: z.number().optional() // ensureVersion tolerates undefined (409)
});

/**
 * PATCH /api/v1/users/{id} — exactly one of the two branches. Because both branches are
 * strict, a body carrying `active` alongside `displayName`/`email` fails both and 422s.
 */
export const patchUserSchema = z.union([setUserActiveSchema, updateUserProfileSchema]);

/**
 * POST /api/v1/users/{id}/password -> `resetUserPassword`.
 *
 * Mirrors `changeOwnPasswordSchema`'s tolerance: blankness and the 8-character floor are
 * the domain's own 422s. Unlike that schema there is no `currentPassword` — this path
 * exists precisely for when the target cannot supply one — and `strictObject` blocks a
 * smuggled `userId`; the target is always the path param, resolved server-side.
 */
export const resetUserPasswordSchema = z.strictObject({
  newPassword: z.string(), // length floor enforced in the domain
  version: z.number().optional() // ensureVersion tolerates undefined (409)
});

/**
 * POST /api/v1/controlled-values -> `createControlledValue`.
 *
 * `catalogue` is limited to the three documented catalogues (`docs/data-model.md:40` —
 * Priority, Severity, Result; lifecycle values are not editable configuration). A new
 * catalogue name would be a policy change, so an unknown one is refused at the boundary.
 * `value` gets `.min(1)` mirroring the domain's `requireNonBlank`; trimming and the
 * duplicate 409 stay in the domain.
 */
export const createControlledValueSchema = z.strictObject({
  catalogue: z.enum([CATALOGUE_PRIORITY, CATALOGUE_SEVERITY, CATALOGUE_RESULT]),
  value: z.string().min(1) // requireNonBlank — admin.ts createControlledValue
});
