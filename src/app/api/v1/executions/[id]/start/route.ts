import { startExecution } from "@/domain/executions";
import { parseWith } from "@/lib/request";
import { startExecutionSchema } from "@/lib/request-schemas/executions";
import { withRoute } from "@/lib/route";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Params) {
  return withRoute(request, async ({ auth, requestId }) => {
    const { id } = await context.params;
    const body = await parseWith(startExecutionSchema, request);
    const result = await startExecution(id, body.version, {
      userId: auth.userId,
      role: auth.role,
      requestId
    });
    return Response.json(result);
  });
}
