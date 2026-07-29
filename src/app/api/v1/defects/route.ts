import { createDefect, listDefects } from "@/domain/defects";
import { parseJson } from "@/lib/request";
import { withRoute } from "@/lib/route";

export async function GET(request: Request) {
  return withRoute(request, async () => {
    const rows = await listDefects();
    return Response.json(rows);
  });
}

export async function POST(request: Request) {
  return withRoute(request, async ({ auth, requestId }) => {
    const body = await parseJson<{
      businessId: string;
      testCaseId: string;
      summary: string;
      priority: string;
      severity: string;
    }>(request);
    const created = await createDefect(body, { userId: auth.userId, role: auth.role, requestId });
    return Response.json(created, { status: 201 });
  });
}
