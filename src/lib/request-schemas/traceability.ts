import { z } from "zod";

/** Request-shape schema for the RTM link route, mirroring `src/domain/traceability.ts`. */

/**
 * POST /api/v1/rtm-links -> `createRtmLink`.
 *
 * `strictObject` matters more than usual here: the route used to spread the parsed body into
 * the domain input alongside `actorId` / `actorRole` / `requestId`, so an unvalidated body
 * could have overwritten the authenticated actor's role. The route now passes three explicit
 * fields, and this schema is the second, independent guard.
 */
export const createRtmLinkSchema = z.strictObject({
  requirementId: z.string(), // no blank guard; unresolved id 404s — traceability.ts:22-32
  testCaseId: z.string(), // no blank guard; unresolved id 404s — traceability.ts:26-32
  defectId: z.string().optional() // optional link; mismatched id 422s — traceability.ts:48-53
});
