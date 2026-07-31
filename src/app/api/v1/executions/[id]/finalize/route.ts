import { finalizeExecution } from "@/domain/executions";
import { parseWith } from "@/lib/request";
import { finalizeExecutionSchema } from "@/lib/request-schemas/executions";
import { withRoute } from "@/lib/route";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Params) {
  return withRoute(request, async ({ auth, requestId }) => {
    const { id } = await context.params;
    const body = await parseWith(finalizeExecutionSchema, request);
    const result = await finalizeExecution(id, body, {
      userId: auth.userId,
      role: auth.role,
      requestId
    });
    return Response.json(result);
  });
}
