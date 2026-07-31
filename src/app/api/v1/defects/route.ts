import { createDefect, listDefects } from "@/domain/defects";
import { parseWith } from "@/lib/request";
import { createDefectSchema } from "@/lib/request-schemas/defects";
import { withRoute } from "@/lib/route";

export async function GET(request: Request) {
  return withRoute(request, async () => {
    const rows = await listDefects();
    return Response.json(rows);
  });
}

export async function POST(request: Request) {
  return withRoute(request, async ({ auth, requestId }) => {
    const body = await parseWith(createDefectSchema, request);
    const created = await createDefect(body, { userId: auth.userId, role: auth.role, requestId });
    return Response.json(created, { status: 201 });
  });
}
