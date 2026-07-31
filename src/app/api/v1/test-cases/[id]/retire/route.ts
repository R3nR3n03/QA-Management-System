import { retireTestCase } from "@/domain/test-cases";
import { parseWith } from "@/lib/request";
import { retireTestCaseSchema } from "@/lib/request-schemas/test-cases";
import { withRoute } from "@/lib/route";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Params) {
  return withRoute(request, async ({ auth, requestId }) => {
    const { id } = await context.params;
    const body = await parseWith(retireTestCaseSchema, request);
    const result = await retireTestCase(id, body, {
      userId: auth.userId,
      role: auth.role,
      requestId
    });
    return Response.json(result);
  });
}
