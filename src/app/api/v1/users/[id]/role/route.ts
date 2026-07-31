import { updateUserRole } from "@/domain/admin";
import { parseWith } from "@/lib/request";
import { updateUserRoleSchema } from "@/lib/request-schemas/admin";
import { withRoute } from "@/lib/route";
import { ensureRole, RoleSets } from "@/lib/rbac";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Params) {
  return withRoute(request, async ({ auth, requestId }) => {
    ensureRole([...RoleSets.canAdmin], auth.role);
    const { id } = await context.params;
    const body = await parseWith(updateUserRoleSchema, request);
    const updated = await updateUserRole(id, {
      role: body.role,
      version: body.version,
      actorId: auth.userId,
      requestId
    });
    return Response.json(updated);
  });
}
