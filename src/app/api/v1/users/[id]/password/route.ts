import { resetUserPassword } from "@/domain/admin";
import { parseWith } from "@/lib/request";
import { resetUserPasswordSchema } from "@/lib/request-schemas/admin";
import { withRoute } from "@/lib/route";

type Params = { params: Promise<{ id: string }> };

// The QA-Lead gate, the self-reset guard, and the session revocation all live in the
// domain service, where api-and-security.md:38 requires it, rather than only here.

export async function POST(request: Request, context: Params) {
  return withRoute(request, async ({ auth, requestId }) => {
    const { id } = await context.params;
    const body = await parseWith(resetUserPasswordSchema, request);
    const updated = await resetUserPassword(id, {
      newPassword: body.newPassword,
      version: body.version,
      actorId: auth.userId,
      actorRole: auth.role,
      requestId
    });
    return Response.json(updated);
  });
}
