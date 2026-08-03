import { createTestCase, listTestCases } from "@/domain/test-cases";
import { parseWith } from "@/lib/request";
import { createTestCaseSchema } from "@/lib/request-schemas/test-cases";
import { withRoute } from "@/lib/route";

export async function GET(request: Request) {
  return withRoute(request, async () => {
    // Unpaged, so the response stays the bare array this endpoint has always returned.
    // The service now supports `{ page }`; wiring it up here needs the paginated
    // response envelope, which `docs/` does not establish — see `src/lib/pagination.ts`.
    const { rows } = await listTestCases();
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
