import { prisma } from "@/lib/db";
import { withRoute } from "@/lib/route";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Params) {
  return withRoute(request, async () => {
    const { id } = await context.params;
    const run = await prisma.importRun.findUnique({
      where: { id },
      include: { rows: { orderBy: [{ sourceSheet: "asc" }, { sourceRow: "asc" }] } }
    });
    return run
      ? Response.json(run)
      : Response.json({ error: { code: "REFERENCE_NOT_FOUND", message: "Import run not found." } }, { status: 404 });
  });
}
