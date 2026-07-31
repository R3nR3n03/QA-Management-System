import { createTestCase, listTestCases } from "@/domain/test-cases";
import { parseWith } from "@/lib/request";
import { createTestCaseSchema } from "@/lib/request-schemas";
import { withRoute } from "@/lib/route";

export async function GET(request: Request) {
  return withRoute(request, async () => {
    const rows = await listTestCases();
    return Response.json(rows);
  });
}

export async function POST(request: Request) {
  return withRoute(request, async ({ auth, requestId }) => {
    const body = await parseWith(createTestCaseSchema, request);

    const created = await createTestCase(body, { userId: auth.userId, role: auth.role, requestId });
    return Response.json(created, { status: 201 });
  });
}
