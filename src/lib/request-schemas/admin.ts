import { QamsRole } from "@prisma/client";
import { z } from "zod";

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
