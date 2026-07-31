import { updateExecution } from "@/domain/executions";
import { parseWith } from "@/lib/request";
import { updateExecutionSchema } from "@/lib/request-schemas/executions";
import { withRoute } from "@/lib/route";

type Params = { params: Promise<{ id: string }> };

// Tester reassignment while Planned. The state rule, the active-tester rule and the
// role gate all live in updateExecution (api-and-security.md:38); lifecycle
// transitions stay on their explicit sibling endpoints (start/finalize).
export async function PATCH(request: Request, context: Params) {
  return withRoute(request, async ({ auth, requestId }) => {
    const { id } = await context.params;
    const body = await parseWith(updateExecutionSchema, request);
    const updated = await updateExecution(
      id,
      { testerId: body.testerId, version: body.version },
      { userId: auth.userId, role: auth.role, requestId }
    );
    return Response.json(updated);
  });
}
