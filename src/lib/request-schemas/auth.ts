import { z } from "zod";

/** Request-shape schema for the authentication routes. */

/**
 * POST /api/v1/auth/login.
 *
 * Additive only: the route keeps its existing hand-checks. Both fields are plain `z.string()`
 * rather than `.min(1)` on purpose — `.min(1)` would still admit `email: " "`, so it does not
 * subsume the hand-check at auth/login/route.ts:12, and having both a schema rule and the
 * hand-check disagree about which one rejects a blank would make the 422 harder to reason
 * about. The schema's job here is only to guarantee the body is an object with two string
 * fields, so `null` / a scalar / an array becomes a 422 instead of a 500.
 *
 * `strictObject` also stops a caller sending extra keys to the one unauthenticated endpoint.
 */
export const loginSchema = z.strictObject({
  email: z.string(), // blankness checked by the route's own guard — auth/login/route.ts:12
  password: z.string() // emptiness checked by the route's own guard — auth/login/route.ts:12
});
