import { createExecution, listExecutions } from "@/domain/executions";
import { parseJson } from "@/lib/request";
import { withRoute } from "@/lib/route";

export async function GET(request: Request) {
  return withRoute(request, async () => {
    const rows = await listExecutions();
    return Response.json(rows);
  });
}

export async function POST(request: Request) {
  return withRoute(request, async ({ auth, requestId }) => {
    const body = await parseJson<{ businessId: string; testCaseId: string; testerId: string }>(request);
    const created = await createExecution(body, { userId: auth.userId, role: auth.role, requestId });
    return Response.json(created, { status: 201 });
  });
}
