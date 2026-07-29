import { executionHistory } from "@/domain/executions";
import { withRoute } from "@/lib/route";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Params) {
  return withRoute(request, async () => {
    const { id } = await context.params;
    const rows = await executionHistory(id);
    return Response.json(rows);
  });
}
