import { createProduct, listProducts } from "@/domain/catalogue";
import { parseJson } from "@/lib/request";
import { withRoute } from "@/lib/route";

export async function GET(request: Request) {
  return withRoute(request, async () => {
    const items = await listProducts();
    return Response.json(items);
  });
}

export async function POST(request: Request) {
  return withRoute(request, async ({ auth, requestId }) => {
    const body = await parseJson<{
      businessId: string;
      name: string;
      versionTag: string;
      status: string;
    }>(request);
    const created = await createProduct(body, { userId: auth.userId, role: auth.role, requestId });
    return Response.json(created, { status: 201 });
  });
}
