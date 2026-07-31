import { getModule, updateModule } from "@/domain/catalogue";
import { parseWith } from "@/lib/request";
import { updateModuleSchema } from "@/lib/request-schemas/catalogue";
import { withRoute } from "@/lib/route";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Params) {
  return withRoute(request, async () => {
    const { id } = await context.params;
    return Response.json(await getModule(id));
  });
}

export async function PATCH(request: Request, context: Params) {
  return withRoute(request, async ({ auth, requestId }) => {
    const { id } = await context.params;
    const body = await parseWith(updateModuleSchema, request);
    const updated = await updateModule(id, body, { userId: auth.userId, role: auth.role, requestId });
    return Response.json(updated);
  });
}
