import { getCheckBatch } from "@/domain/checks";
import { withRoute } from "@/lib/route";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Params) {
  return withRoute(request, async ({ auth }) => {
    const { id } = await context.params;
    return Response.json(await getCheckBatch(id, auth.role));
  });
}
