import { listControlledValues, updateControlledValue } from "@/domain/admin";
import { parseWith } from "@/lib/request";
import { updateControlledValueSchema } from "@/lib/request-schemas/admin";
import { withRoute } from "@/lib/route";
import { ensureRole, RoleSets } from "@/lib/rbac";

export async function GET(request: Request) {
  return withRoute(request, async () => {
    const rows = await listControlledValues();
    return Response.json(rows);
  });
}

export async function PATCH(request: Request) {
  return withRoute(request, async ({ auth, requestId }) => {
    ensureRole([...RoleSets.canAdmin], auth.role);
    const body = await parseWith(updateControlledValueSchema, request);
    const updated = await updateControlledValue(body.id, {
      active: body.active,
      version: body.version,
      actorId: auth.userId,
      requestId
    });
    return Response.json(updated);
  });
}
