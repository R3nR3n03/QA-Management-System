import { createTestCase, listTestCases } from "@/domain/test-cases";
import { parseJson } from "@/lib/request";
import { withRoute } from "@/lib/route";

export async function GET(request: Request) {
  return withRoute(request, async () => {
    const rows = await listTestCases();
    return Response.json(rows);
  });
}

export async function POST(request: Request) {
  return withRoute(request, async ({ auth, requestId }) => {
    const body = await parseJson<{
      businessId: string;
      productId: string;
      moduleId: string;
      featureId: string;
      requirementId: string;
      cycle: string;
      sprint: string;
      release: string;
      environment: string;
      priority: string;
      severity: string;
      title: string;
      objective: string;
      expectedResult: string;
    }>(request);

    const created = await createTestCase(body, { userId: auth.userId, role: auth.role, requestId });
    return Response.json(created, { status: 201 });
  });
}
