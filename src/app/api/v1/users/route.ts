import { createUser } from "@/domain/admin";
import { parseWith } from "@/lib/request";
import { createUserSchema } from "@/lib/request-schemas/admin";
import { withRoute } from "@/lib/route";

// The QA-Lead gate lives in createUser, where api-and-security.md:38 requires it.
export async function POST(request: Request) {
  return withRoute(request, async ({ auth, requestId }) => {
    const body = await parseWith(createUserSchema, request);
    const created = await createUser(body, { userId: auth.userId, role: auth.role, requestId });
    return Response.json(created, { status: 201 });
  });
}
