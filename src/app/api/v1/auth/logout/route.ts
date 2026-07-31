import { cookies } from "next/headers";
import { revokeSessions } from "@/domain/auth";
import { logRequest, requestTarget } from "@/lib/logging";
import { requestMetadata } from "@/lib/request-metadata";
import { SESSION_COOKIE_NAME, verifySessionCookieValue } from "@/lib/session";

/**
 * Sign out, and actually revoke (A6).
 *
 * This used to delete the client's cookie and stop. A stateless signed token is valid
 * because it is signed, not because the client still holds it — so any duplicate kept
 * working until it expired. Stamping `sessionsValidFrom` refuses every token issued before
 * now, on every device.
 *
 * Not wrapped in `withRoute`: that runs `requireAuth()`, and logout must work when the
 * session is already invalid. **Idempotent by design** — no cookie, an expired one, a forged
 * one, or an already-revoked one all clear whatever is there and return 204. Logging out is
 * the one action that must never fail; someone trying to end a session they are worried
 * about should never be met with an error.
 *
 * Order matters: the cookie is cleared FIRST. If the revoking write then fails, the user
 * still gets the local effect they asked for, and the failure is logged rather than
 * swallowed. The honest consequence — a copy of the token elsewhere survives until expiry —
 * is exactly why that log line says so.
 */
export async function POST(request: Request) {
  const startedAt = Date.now();
  const { requestId } = await requestMetadata();
  const target = requestTarget(request);

  const store = await cookies();
  const session = verifySessionCookieValue(store.get(SESSION_COOKIE_NAME)?.value);

  store.delete(SESSION_COOKIE_NAME);

  let revokeFailed: string | undefined;
  if (session) {
    try {
      await revokeSessions(session.userId);
    } catch (error) {
      revokeFailed = error instanceof Error ? error.message : String(error);
    }
  }

  logRequest({
    ...target,
    occurredAt: new Date().toISOString(),
    requestId,
    // 204 either way: the status reports what the caller got, and the caller got a cleared
    // cookie. `errorCode` below is what says the revocation did not land.
    status: 204,
    actorId: session?.userId,
    action: "AUTH_LOGGED_OUT",
    errorCode: revokeFailed ? "INTERNAL_ERROR" : undefined,
    message: revokeFailed
      ? `Cookie cleared but revocation failed; copies of this token remain valid until expiry: ${revokeFailed}`
      : session
        ? "Sessions revoked."
        : "No valid session presented; cookie cleared.",
    durationMs: Date.now() - startedAt
  });

  return new Response(null, { status: 204 });
}
