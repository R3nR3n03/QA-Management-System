import { prisma } from "@/lib/db";
import { updateDefectDetails } from "@/domain/defects";
import { parseWith } from "@/lib/request";
import { updateDefectDetailsSchema } from "@/lib/request-schemas/defects";
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
    const body = await parseWith(updateDefectDetailsSchema, request);
    const updated = await updateDefectDetails(id, body, { userId: auth.userId, role: auth.role, requestId });
    return Response.json(updated);
  });
}
