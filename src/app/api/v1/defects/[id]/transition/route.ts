import { DefectLifecycleState } from "@prisma/client";
import { transitionDefect } from "@/domain/defects";
import { parseJson } from "@/lib/request";
import { withRoute } from "@/lib/route";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Params) {
  return withRoute(request, async ({ auth, requestId }) => {
    const { id } = await context.params;
    const body = await parseJson<{
      version: number;
      targetStatus: DefectLifecycleState;
      investigationOwnerId?: string;
      resolutionSummary?: string;
      retestEvidenceRef?: string;
      closureRationale?: string;
      reopenReason?: string;
    }>(request);
    const result = await transitionDefect(id, body, {
      userId: auth.userId,
      role: auth.role,
      requestId
    });
    return Response.json(result);
  });
}
