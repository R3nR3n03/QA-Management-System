import { transitionDefect } from "@/domain/defects";
import { parseWith } from "@/lib/request";
import { transitionDefectSchema } from "@/lib/request-schemas/defects";
import { withRoute } from "@/lib/route";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Params) {
  return withRoute(request, async ({ auth, requestId }) => {
    const { id } = await context.params;
    const body = await parseWith(transitionDefectSchema, request);
    const result = await transitionDefect(id, body, {
      userId: auth.userId,
      role: auth.role,
      requestId
    });
    return Response.json(result);
  });
}
