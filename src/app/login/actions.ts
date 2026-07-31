"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { authenticate, revokeSessions } from "@/domain/auth";
import { AppError } from "@/lib/errors";
import { logRequest } from "@/lib/logging";
import { loginThrottle, throttleLogMessage, type ThrottleDimension } from "@/lib/login-throttle";
import { requestMetadata } from "@/lib/request-metadata";
import {
  createSessionCookieValue,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
  verifySessionCookieValue
} from "@/lib/session";
import { errorCopy } from "@/ui/error-copy";

export type LoginState = { title: string; detail: string } | null;

/**
 * Sign in. Not wrapped in `runAction` — that helper authenticates first, which is
 * the one thing this cannot do.
 *
 * Because it is not wrapped, nothing throttles this for free: the limiter has to be
 * called explicitly. `docs/api-and-security.md:43` requires rate limiting on
 * authentication endpoints, and this action is a SECOND entry point to the same
 * credential check as `POST /api/v1/auth/login`. Throttling only the REST route would
 * leave the form — the easier target of the two, since a browser reaches it directly —
 * wide open, which is precisely the hole A3 exists to close.
 */
export async function signIn(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  if (!email.trim() || !password) {
    return { title: "Enter your email and password.", detail: "Both are needed to sign in." };
  }

  // A3. The same three-step protocol the REST route drives, in the same order, through the
  // same module — see `src/lib/login-throttle.ts`. Both entry points reach the identical
  // credential check, so they must meter it identically or the cheaper door becomes the
  // one an attacker uses. Do not open-code a variation of this sequence here.
  const requestHeaders = await headers();

  // Step 1: peek, no spend.
  // Step 2: spend the account's allowance — every attempt pays, win or lose.
  // Evaluated separately rather than in one `||` so the tripped dimension is known and can
  // be logged; the short-circuit order is identical either way.
  let throttled: ThrottleDimension | undefined;
  if (!loginThrottle.clientAllowed(requestHeaders)) throttled = "client";
  else if (!loginThrottle.consumeEmail(email)) throttled = "email";

  if (throttled !== undefined) {
    // This is the door a NAT'd office actually uses, so a throttle here is the incident an
    // operator most needs to see — and it emitted nothing at all until now, which made the
    // dimension discriminator useless exactly where it mattered. Same shape and same
    // AUTH_FAILED action as the REST route, so both doors aggregate together.
    //
    // The message carries the dimension and nothing else: no address, no email, no hash.
    // `throttleLogMessage` is a closed function of a two-member union, so no caller-supplied
    // value can reach the log through it.
    const { requestId } = await requestMetadata();
    logRequest({
      occurredAt: new Date().toISOString(),
      requestId,
      status: 403,
      method: "POST",
      path: "/login",
      action: "AUTH_FAILED",
      errorCode: "UNAUTHORIZED",
      message: throttleLogMessage(throttled)
    });

    // Reported as its own form state rather than by throwing `rateLimitError()`, which the
    // REST route does. Both refusals are the same `403 UNAUTHORIZED` on the wire, but here
    // that code renders through `errorCopy` as "That email and password don't match." —
    // telling a locked-out user to keep trying the very thing locking them out. This runs
    // before `authenticate()`, so there is no AppError to discriminate and no ambiguity.
    // `src/lib/rate-limit.ts` remains the only place the API's status and code are decided.
    //
    // The dimension stays out of this copy deliberately: telling the user which bucket
    // tripped would say whether the account exists.
    return {
      title: "Too many sign-in attempts.",
      detail: "Wait a few minutes and try again. If you've forgotten the password, a QA Lead can reset it."
    };
  }

  try {
    const user = await authenticate(email, password);
    const store = await cookies();
    // A7: shared with `src/app/api/v1/auth/login/route.ts`. See `sessionCookieOptions`.
    store.set(SESSION_COOKIE_NAME, createSessionCookieValue(user.id), sessionCookieOptions());
  } catch (error) {
    if (error instanceof AppError) {
      const copy = errorCopy(error.code, error.field);
      // Deliberately not the generic UNAUTHORIZED wording: at a sign-in form the
      // useful sentence is about the credentials, not about roles.
      if (error.code === "UNAUTHORIZED") {
        // Step 3. `authenticate` raises UNAUTHORIZED for "no such account", "inactive" and
        // "wrong password" alike, so this is exactly the failed-credential branch the REST
        // route charges — and, as there, a SUCCESSFUL sign-in charges the client bucket
        // nothing. See `login-throttle.ts` for why the two dimensions differ.
        loginThrottle.recordFailure(requestHeaders);
        return {
          title: "That email and password don't match.",
          detail: "Check both and try again. If the account was deactivated, a QA Lead can restore it."
        };
      }
      return { title: copy.title, detail: copy.detail };
    }
    return { title: "Something broke on our side.", detail: "Nothing was saved. Try again." };
  }

  redirect("/my-work");
}

/**
 * Sign out from the UI. Same contract as `POST /api/v1/auth/logout` — clear the cookie AND
 * revoke every token issued before now (A6) — because a user who signs out through the shell
 * has exactly the same expectation as one who calls the API, and two doors that end sessions
 * differently is the class of divergence that made the login throttle a three-round fix.
 *
 * Idempotent, and it never throws: the cookie is cleared first, a failed revocation is logged
 * rather than surfaced, and the redirect happens regardless. `redirect()` signals by throwing,
 * so it must stay outside the try.
 */
export async function signOut(): Promise<void> {
  const startedAt = Date.now();
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

  const { requestId } = await requestMetadata();
  logRequest({
    occurredAt: new Date().toISOString(),
    requestId,
    status: 204,
    method: "POST",
    path: "/login",
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

  redirect("/login");
}
