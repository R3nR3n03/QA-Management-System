import { getRequirement, updateRequirement } from "@/domain/catalogue";
import { parseWith } from "@/lib/request";
import { updateRequirementSchema } from "@/lib/request-schemas/catalogue";
import { withRoute } from "@/lib/route";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Params) {
  return withRoute(request, async () => {
    const { id } = await context.params;
    return Response.json(await getRequirement(id));
  });
}

export async function PATCH(request: Request, context: Params) {
  return withRoute(request, async ({ auth, requestId }) => {
    const { id } = await context.params;
    const body = await parseWith(updateRequirementSchema, request);
    const updated = await updateRequirement(id, body, { userId: auth.userId, role: auth.role, requestId });
    return Response.json(updated);
  });
}
