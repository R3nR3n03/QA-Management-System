import { finalizeExecution } from "@/domain/executions";
import { parseJson } from "@/lib/request";
import { withRoute } from "@/lib/route";
import { ExecutionOutcome } from "@prisma/client";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Params) {
  return withRoute(request, async ({ auth, requestId }) => {
    const { id } = await context.params;
    const body = await parseJson<{
      version: number;
      result: ExecutionOutcome;
      actualResult: string;
      blockReason?: string;
      defectId?: string;
      createDefect?: {
        businessId: string;
        summary: string;
        priority: string;
        severity: string;
      };
    }>(request);
    const result = await finalizeExecution(id, body, {
      userId: auth.userId,
      role: auth.role,
      requestId
    });
    return Response.json(result);
  });
}
