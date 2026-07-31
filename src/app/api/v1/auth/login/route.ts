import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { AppError, asErrorResponse } from "@/lib/errors";
import { logRequest, requestTarget } from "@/lib/logging";
import { verifyPassword } from "@/lib/password";
import { parseWith } from "@/lib/request";
import { requestMetadata } from "@/lib/request-metadata";
import { loginSchema } from "@/lib/request-schemas/auth";
import { createSessionCookieValue, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from "@/lib/session";

/**
 * Authentication is logged separately from `withRoute` because it is the one endpoint
 * where there is no authenticated actor to attribute a line to, and where the failures
 * matter more than the successes.
 *
 * A failed attempt records `AUTH_FAILED` with no user id — that is the honest record,
 * and it is what a rate limiter and any later alerting will key on
 * (`docs/api-and-security.md:43` requires rate limiting here; none exists yet, which is
 * exactly why the signal needs to be visible in the meantime).
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

  try {
    // The schema guarantees an object with two string fields; the blank/empty checks below are
    // kept deliberately (a `.min(1)` would still admit `email: " "`).
    const body = await parseWith(loginSchema, request);
    if (!body.email.trim() || !body.password) {
      throw new AppError(422, "ID_INVALID", "Email and password are required.");
    }

    const user = await prisma.user.findUnique({ where: { email: body.email.trim() } });
    if (!user || !user.active || !verifyPassword(body.password, user.passwordHash)) {
      throw new AppError(403, "UNAUTHORIZED", "Invalid credentials.");
    }

    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE_NAME, createSessionCookieValue(user.id), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS
    });

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
      error instanceof Error ? error.message : String(error),
      error instanceof Error ? error.stack : undefined
    );
    return response;
  }
}
