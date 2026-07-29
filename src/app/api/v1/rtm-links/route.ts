import { createRtmLink, listRtmLinks } from "@/domain/traceability";
import { parseJson } from "@/lib/request";
import { withRoute } from "@/lib/route";

export async function GET(request: Request) {
  return withRoute(request, async () => {
    const rows = await listRtmLinks();
    return Response.json(rows);
  });
}

export async function POST(request: Request) {
  return withRoute(request, async ({ auth, requestId }) => {
    const body = await parseJson<{ requirementId: string; testCaseId: string; defectId?: string }>(request);
    const created = await createRtmLink({
      ...body,
      actorId: auth.userId,
      actorRole: auth.role,
      requestId
    });
    return Response.json(created, { status: 201 });
  });
}
