import { createFeature, listFeatures } from "@/domain/catalogue";
import { parseWith } from "@/lib/request";
import { createFeatureSchema } from "@/lib/request-schemas/catalogue";
import { withRoute } from "@/lib/route";

export async function GET(request: Request) {
  return withRoute(request, async () => {
    const rows = await listFeatures();
    return Response.json(rows);
  });
}

export async function POST(request: Request) {
  return withRoute(request, async ({ auth, requestId }) => {
    const body = await parseWith(createFeatureSchema, request);
    const created = await createFeature(body, { userId: auth.userId, role: auth.role, requestId });
    return Response.json(created, { status: 201 });
  });
}
