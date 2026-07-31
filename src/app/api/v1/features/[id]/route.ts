import { getFeature, updateFeature } from "@/domain/catalogue";
import { parseWith } from "@/lib/request";
import { updateFeatureSchema } from "@/lib/request-schemas/catalogue";
import { withRoute } from "@/lib/route";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Params) {
  return withRoute(request, async () => {
    const { id } = await context.params;
    return Response.json(await getFeature(id));
  });
}

export async function PATCH(request: Request, context: Params) {
  return withRoute(request, async ({ auth, requestId }) => {
    const { id } = await context.params;
    const body = await parseWith(updateFeatureSchema, request);
    const updated = await updateFeature(id, body, { userId: auth.userId, role: auth.role, requestId });
    return Response.json(updated);
  });
}
