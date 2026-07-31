import { createRtmLink, listRtmLinks } from "@/domain/traceability";
import { parseWith } from "@/lib/request";
import { createRtmLinkSchema } from "@/lib/request-schemas/traceability";
import { withRoute } from "@/lib/route";

export async function GET(request: Request) {
  return withRoute(request, async () => {
    const rows = await listRtmLinks();
    return Response.json(rows);
  });
}

export async function POST(request: Request) {
  return withRoute(request, async ({ auth, requestId }) => {
    const body = await parseWith(createRtmLinkSchema, request);
    // Explicit fields, never a spread: the domain input carries `actorId` / `actorRole` /
    // `requestId`, which are server-supplied and must not be reachable from the request body.
    const created = await createRtmLink({
      requirementId: body.requirementId,
      testCaseId: body.testCaseId,
      defectId: body.defectId,
      actorId: auth.userId,
      actorRole: auth.role,
      requestId
    });
    return Response.json(created, { status: 201 });
  });
}
