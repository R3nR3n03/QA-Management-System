import { getDefect, updateDefectDetails } from "@/domain/defects";
import { parseWith } from "@/lib/request";
import { updateDefectDetailsSchema } from "@/lib/request-schemas/defects";
import { withRoute } from "@/lib/route";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Params) {
  return withRoute(request, async () => {
    const { id } = await context.params;
    return Response.json(await getDefect(id));
  });
}

export async function PATCH(request: Request, context: Params) {
  return withRoute(request, async ({ auth, requestId }) => {
    const { id } = await context.params;
    const body = await parseWith(updateDefectDetailsSchema, request);
    const updated = await updateDefectDetails(id, body, { userId: auth.userId, role: auth.role, requestId });
    return Response.json(updated);
  });
}
