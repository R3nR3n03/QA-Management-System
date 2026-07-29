import { prisma } from "@/lib/db";
import { updateTestCaseDraft } from "@/domain/test-cases";
import { parseJson } from "@/lib/request";
import { withRoute } from "@/lib/route";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Params) {
  return withRoute(request, async () => {
    const { id } = await context.params;
    const row = await prisma.testCase.findUnique({
      where: { id },
      include: { steps: { orderBy: { sequence: "asc" } } }
    });
    return row
      ? Response.json(row)
      : Response.json({ error: { code: "REFERENCE_NOT_FOUND", message: "Test case not found." } }, { status: 404 });
  });
}

export async function PATCH(request: Request, context: Params) {
  return withRoute(request, async ({ auth, requestId }) => {
    const { id } = await context.params;
    const body = await parseJson<{
      version: number;
      cycle?: string;
      sprint?: string;
      release?: string;
      environment?: string;
      priority?: string;
      severity?: string;
      title?: string;
      objective?: string;
      expectedResult?: string;
    }>(request);
    const updated = await updateTestCaseDraft(id, body, { userId: auth.userId, role: auth.role, requestId });
    return Response.json(updated);
  });
}
