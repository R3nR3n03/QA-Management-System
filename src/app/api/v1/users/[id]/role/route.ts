import { getUserRole, updateUserRole } from "@/domain/admin";
import { parseWith } from "@/lib/request";
import { updateUserRoleSchema } from "@/lib/request-schemas/admin";
import { withRoute } from "@/lib/route";

type Params = { params: Promise<{ id: string }> };

// The QA-Lead gate for both handlers lives in the domain service, where
// api-and-security.md:38 requires it, rather than only here.

export async function GET(request: Request, context: Params) {
  return withRoute(request, async ({ auth }) => {
    const { id } = await context.params;
    const user = await getUserRole(id, auth.role);
    return Response.json(user);
  });
}

export async function PATCH(request: Request, context: Params) {
  return withRoute(request, async ({ auth, requestId }) => {
    const { id } = await context.params;
    const body = await parseWith(updateUserRoleSchema, request);
    const updated = await updateUserRole(id, {
      role: body.role,
      version: body.version,
      actorId: auth.userId,
      actorRole: auth.role,
      requestId
    });
    return Response.json(updated);
  });
}
