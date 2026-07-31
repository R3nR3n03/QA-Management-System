import { returnTestCaseToDraft } from "@/domain/test-cases";
import { parseWith } from "@/lib/request";
import { returnTestCaseToDraftSchema } from "@/lib/request-schemas/test-cases";
import { withRoute } from "@/lib/route";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Params) {
  return withRoute(request, async ({ auth, requestId }) => {
    const { id } = await context.params;
    const body = await parseWith(returnTestCaseToDraftSchema, request);
    const result = await returnTestCaseToDraft(id, body, {
      userId: auth.userId,
      role: auth.role,
      requestId
    });
    return Response.json(result);
  });
}
