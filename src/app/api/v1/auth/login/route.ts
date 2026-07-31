import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { AppError, asErrorResponse } from "@/lib/errors";
import { logRequest, requestTarget } from "@/lib/logging";
import {
  type ThrottleDimension,
  loginThrottle,
  throttleLogMessage
} from "@/lib/login-throttle";
import { verifyPassword } from "@/lib/password";
import { rateLimitError } from "@/lib/rate-limit";
import { parseWith } from "@/lib/request";
import { requestMetadata } from "@/lib/request-metadata";
import { loginSchema } from "@/lib/request-schemas/auth";
import { createSessionCookieValue, SESSION_COOKIE_NAME, sessionCookieOptions } from "@/lib/session";

/**
 * Authentication is logged separately from `withRoute` because it is the one endpoint
 * where there is no authenticated actor to attribute a line to, and where the failures
 * matter more than the successes.
 *
 * A failed attempt records `AUTH_FAILED` with no user id — that is the honest record,
 * and it is what the rate limiter and any later alerting key on
 * (`docs/api-and-security.md:43` requires rate limiting here; `src/lib/rate-limit.ts` now
 * provides it, and a throttled attempt lands on this same AUTH_FAILED line).
 *
 * A throttled attempt is reported as `403 UNAUTHORIZED` — the same code as a wrong
 * password, distinguishable only by its message. That is deliberate and constrained:
 * `docs/business-rules-and-validation.md:5` enumerates 422/403/404/409 only, and adding a
 * `429 RATE_LIMITED` pairing is a policy change requiring a `docs/` edit. See the D-1 note
 * in `src/lib/rate-limit.ts`.
 *
 * The password never reaches the log: it is not passed to `logRequest`, and `redact`
 * would strip it if it were. The attempted email is NOT logged either — no document
 * establishes a policy for logging personal data, and inventing one is not this
 * change's to make. Note the consequence honestly: without it these lines show that
 * failures are happening but not against which account, which limits credential-
 * stuffing forensics. Worth raising with the QA Lead.
 */
export async function POST(request: Request) {
  const startedAt = Date.now();
  const { requestId } = await requestMetadata();
  const target = requestTarget(request);

  const audit = (status: number, errorCode?: string, message?: string, stack?: string) =>
    logRequest({
      ...target,
      occurredAt: new Date().toISOString(),
      requestId,
      status,
      action: status < 400 ? "AUTH_SUCCEEDED" : "AUTH_FAILED",
      errorCode,
      message,
      stack,
      durationMs: Date.now() - startedAt
    });

  // Set only when the throttle is what refused this request, and read by the catch below so
  // the AUTH_FAILED line says WHICH bucket tripped. Without it an operator sees "Too many
  // attempts" and cannot tell an attack from an office sharing one NAT address. It never
  // reaches the response — see `ThrottleDimension`.
  let throttled: ThrottleDimension | undefined;

  try {
    // A3, step 1 of the shared protocol in `src/lib/login-throttle.ts`, which the `signIn`
    // server action drives identically. A PEEK, not a spend: an already-locked-out client
    // is refused before the body is even read, and that refusal costs it nothing further.
    if (!loginThrottle.clientAllowed(request.headers)) {
      throttled = "client";
      throw rateLimitError();
    }

    // The schema guarantees an object with two string fields; the blank/empty checks below are
    // kept deliberately (a `.min(1)` would still admit `email: " "`).
    const body = await parseWith(loginSchema, request);
    if (!body.email.trim() || !body.password) {
      throw new AppError(422, "ID_INVALID", "Email and password are required.");
    }

    // Step 2. The dimension that actually holds: an attacker can rotate the forgeable
    // `x-forwarded-for` past step 1, but not this without abandoning the account. It
    // necessarily comes after parsing — the address is in the body — but is still ahead of
    // every database read and the password hash comparison. Every attempt pays, win or lose.
    if (!loginThrottle.consumeEmail(body.email)) {
      throttled = "email";
      throw rateLimitError();
    }

    const user = await prisma.user.findUnique({ where: { email: body.email.trim() } });
    if (!user || !user.active || !verifyPassword(body.password, user.passwordHash)) {
      // Step 3, and ONLY here. A successful sign-in must not spend client allowance: that
      // key is shared by everyone behind one NAT egress address, so charging successes to
      // it locks out an entire office while the attacker it was aimed at sets one header
      // and walks away. Failures-only keeps the friction and drops the self-inflicted outage.
      loginThrottle.recordFailure(request.headers);
      throw new AppError(403, "UNAUTHORIZED", "Invalid credentials.");
    }

    const cookieStore = await cookies();
    // A7: one definition, shared with `src/app/login/actions.ts`. These options used to be
    // written out here and again there, so tightening one would have left the other behind.
    cookieStore.set(SESSION_COOKIE_NAME, createSessionCookieValue(user.id), sessionCookieOptions());

    // The one place an actor id is safe to attribute: authentication just succeeded.
    logRequest({
      ...target,
      occurredAt: new Date().toISOString(),
      requestId,
      status: 200,
      actorId: user.id,
      action: "AUTH_SUCCEEDED",
      durationMs: Date.now() - startedAt
    });

    return Response.json({ userId: user.id, role: user.role });
  } catch (error) {
    const response = asErrorResponse(error, requestId);
    audit(
      response.status,
      error instanceof AppError ? error.code : "INTERNAL_ERROR",
      // A throttle rejection logs which bucket tripped instead of the user-facing sentence,
      // which is identical for both and says nothing an operator can act on. `message` is
      // documented as the developer-facing field; the client still receives the generic copy.
      throttled !== undefined
        ? throttleLogMessage(throttled)
        : error instanceof Error
          ? error.message
          : String(error),
      error instanceof Error ? error.stack : undefined
    );
    return response;
  }
}
