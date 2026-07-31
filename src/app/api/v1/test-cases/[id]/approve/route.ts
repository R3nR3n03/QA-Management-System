import { approveTestCase } from "@/domain/test-cases";
import { parseWith } from "@/lib/request";
import { approveTestCaseSchema } from "@/lib/request-schemas/test-cases";
import { withRoute } from "@/lib/route";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Params) {
  return withRoute(request, async ({ auth, requestId }) => {
    const { id } = await context.params;
    const body = await parseWith(approveTestCaseSchema, request);
    const result = await approveTestCase(id, body.version, {
      userId: auth.userId,
      role: auth.role,
      requestId
    });
    return Response.json(result);
  });
}
