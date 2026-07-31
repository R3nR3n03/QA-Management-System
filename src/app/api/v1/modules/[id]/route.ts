import { prisma } from "@/lib/db";
import { updateModule } from "@/domain/catalogue";
import { parseWith } from "@/lib/request";
import { updateModuleSchema } from "@/lib/request-schemas/catalogue";
import { withRoute } from "@/lib/route";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Params) {
  return withRoute(request, async () => {
    const { id } = await context.params;
    const row = await prisma.module.findUnique({ where: { id } });
    return row
      ? Response.json(row)
      : Response.json({ error: { code: "REFERENCE_NOT_FOUND", message: "Module not found." } }, { status: 404 });
  });
}

export async function PATCH(request: Request, context: Params) {
  return withRoute(request, async ({ auth, requestId }) => {
    const { id } = await context.params;
    const body = await parseWith(updateModuleSchema, request);
    const updated = await updateModule(id, body, { userId: auth.userId, role: auth.role, requestId });
    return Response.json(updated);
  });
}
