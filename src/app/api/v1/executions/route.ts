import { createExecution, listExecutions } from "@/domain/executions";
import { parseWith } from "@/lib/request";
import { createExecutionSchema } from "@/lib/request-schemas/executions";
import { withRoute } from "@/lib/route";

export async function GET(request: Request) {
  return withRoute(request, async () => {
    const rows = await listExecutions();
    return Response.json(rows);
  });
}

export async function POST(request: Request) {
  return withRoute(request, async ({ auth, requestId }) => {
    const body = await parseWith(createExecutionSchema, request);
    const created = await createExecution(body, { userId: auth.userId, role: auth.role, requestId });
    return Response.json(created, { status: 201 });
  });
}
