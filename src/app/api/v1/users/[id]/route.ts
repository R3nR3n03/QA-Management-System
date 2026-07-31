import { setUserActive, updateUserProfile } from "@/domain/admin";
import { parseWith } from "@/lib/request";
import { patchUserSchema } from "@/lib/request-schemas/admin";
import { withRoute } from "@/lib/route";

type Params = { params: Promise<{ id: string }> };

// The QA-Lead gate for both branches lives in the domain services, where
// api-and-security.md:38 requires it, rather than only here.
//
// One domain call per request: `patchUserSchema` is a union of two STRICT branches, so
// a body carrying `active` alongside profile fields matches neither branch and 422s at
// the boundary — this handler never has to pick between two half-matching intents.
// There is deliberately no GET list route; the people list is a screen concern
// (`listUsers` behind `/admin/users`), not an API surface.
export async function PATCH(request: Request, context: Params) {
  return withRoute(request, async ({ auth, requestId }) => {
    const { id } = await context.params;
    const body = await parseWith(patchUserSchema, request);
    const actor = { actorId: auth.userId, actorRole: auth.role, requestId };
    const updated =
      "active" in body
        ? await setUserActive(id, { active: body.active, version: body.version, ...actor })
        : await updateUserProfile(id, {
            displayName: body.displayName,
            email: body.email,
            version: body.version,
            ...actor
          });
    return Response.json(updated);
  });
}
