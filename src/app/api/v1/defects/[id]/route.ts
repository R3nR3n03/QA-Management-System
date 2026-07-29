import { prisma } from "@/lib/db";
import { updateDefectDetails } from "@/domain/defects";
import { parseJson } from "@/lib/request";
import { withRoute } from "@/lib/route";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Params) {
  return withRoute(request, async () => {
    const { id } = await context.params;
    const row = await prisma.defect.findUnique({ where: { id } });
    return row
      ? Response.json(row)
      : Response.json({ error: { code: "REFERENCE_NOT_FOUND", message: "Defect not found." } }, { status: 404 });
  });
}

export async function PATCH(request: Request, context: Params) {
  return withRoute(request, async ({ auth, requestId }) => {
    const { id } = await context.params;
    const body = await parseJson<{
      version: number;
      summary?: string;
      priority?: string;
      severity?: string;
    }>(request);
    const updated = await updateDefectDetails(id, body, { userId: auth.userId, role: auth.role, requestId });
    return Response.json(updated);
  });
}
