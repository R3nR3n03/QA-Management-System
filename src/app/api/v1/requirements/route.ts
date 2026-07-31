import { createRequirement, listRequirements } from "@/domain/catalogue";
import { parseWith } from "@/lib/request";
import { createRequirementSchema } from "@/lib/request-schemas/catalogue";
import { withRoute } from "@/lib/route";

export async function GET(request: Request) {
  return withRoute(request, async () => {
    const rows = await listRequirements();
    return Response.json(rows);
  });
}

export async function POST(request: Request) {
  return withRoute(request, async ({ auth, requestId }) => {
    const body = await parseWith(createRequirementSchema, request);
    const created = await createRequirement(body, { userId: auth.userId, role: auth.role, requestId });
    return Response.json(created, { status: 201 });
  });
}
