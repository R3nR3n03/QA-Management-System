import { getTestCase, updateTestCaseDraft } from "@/domain/test-cases";
import { parseWith } from "@/lib/request";
import { updateTestCaseDraftSchema } from "@/lib/request-schemas/test-cases";
import { withRoute } from "@/lib/route";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Params) {
  return withRoute(request, async () => {
    const { id } = await context.params;
    return Response.json(await getTestCase(id));
  });
}

export async function PATCH(request: Request, context: Params) {
  return withRoute(request, async ({ auth, requestId }) => {
    const { id } = await context.params;
    const body = await parseWith(updateTestCaseDraftSchema, request);
    const updated = await updateTestCaseDraft(id, body, { userId: auth.userId, role: auth.role, requestId });
    return Response.json(updated);
  });
}
