import { QamsRole } from "@prisma/client";
import { updateUserRole } from "@/domain/admin";
import { parseJson } from "@/lib/request";
import { withRoute } from "@/lib/route";
import { ensureRole, RoleSets } from "@/lib/rbac";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Params) {
  return withRoute(request, async ({ auth, requestId }) => {
    ensureRole([...RoleSets.canAdmin], auth.role);
    const { id } = await context.params;
    const body = await parseJson<{ role: QamsRole; version: number }>(request);
    const updated = await updateUserRole(id, {
      role: body.role,
      version: body.version,
      actorId: auth.userId,
      requestId
    });
    return Response.json(updated);
  });
}
