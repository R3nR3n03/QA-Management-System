import { cookies } from "next/headers";
import { changeOwnPassword } from "@/domain/auth";
import { parseWith } from "@/lib/request";
import { changeOwnPasswordSchema } from "@/lib/request-schemas/auth";
import { withRoute } from "@/lib/route";
import { createSessionCookieValue, SESSION_COOKIE_NAME, sessionCookieOptions } from "@/lib/session";

/**
 * Self-service password change. The domain revokes every session as of the change
 * instant; the fresh cookie set here is stamped with that same instant, so this
 * browser stays signed in while every other copy of the old cookie dies.
 */
export async function POST(request: Request) {
  return withRoute(request, async ({ auth, requestId }) => {
    const body = await parseWith(changeOwnPasswordSchema, request);
    const { issuedAtMs } = await changeOwnPassword(auth.userId, body, requestId);

    const cookieStore = await cookies();
    cookieStore.set(
      SESSION_COOKIE_NAME,
      createSessionCookieValue(auth.userId, issuedAtMs),
      sessionCookieOptions()
    );

    return Response.json({ ok: true });
  });
}
