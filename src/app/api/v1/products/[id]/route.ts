import { prisma } from "@/lib/db";
import { updateProduct } from "@/domain/catalogue";
import { parseJson } from "@/lib/request";
import { withRoute } from "@/lib/route";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Params) {
  return withRoute(request, async () => {
    const { id } = await context.params;
    const item = await prisma.product.findUnique({ where: { id } });
    return item
      ? Response.json(item)
      : Response.json({ error: { code: "REFERENCE_NOT_FOUND", message: "Product not found." } }, { status: 404 });
  });
}

export async function PATCH(request: Request, context: Params) {
  return withRoute(request, async ({ auth, requestId }) => {
    const { id } = await context.params;
    const body = await parseJson<{
      name?: string;
      versionTag?: string;
      status?: string;
      version: number;
    }>(request);
    const updated = await updateProduct(id, body, { userId: auth.userId, role: auth.role, requestId });
    return Response.json(updated);
  });
}
