import { createHmac, timingSafeEqual } from "crypto";

export const SESSION_COOKIE_NAME = "qams_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const SESSION_MAX_AGE_SECONDS = SESSION_TTL_MS / 1000;

function sessionSecret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value) {
    throw new Error("SESSION_SECRET is not configured.");
  }
  return value;
}

function sign(payload: string): string {
  return createHmac("sha256", sessionSecret()).update(payload).digest("hex");
}

export function createSessionCookieValue(userId: string): string {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const payload = `${userId}.${expiresAt}`;
  return `${payload}.${sign(payload)}`;
}

/**
 * The shape `cookies().set()` takes for the session cookie. Narrow on purpose: the two
 * values that must never drift (`httpOnly`, `sameSite`) are literal types, so a call site
 * cannot quietly loosen one and still typecheck.
 */
export type SessionCookieOptions = {
  httpOnly: true;
  secure: boolean;
  sameSite: "strict";
  path: "/";
  maxAge: number;
};

/**
 * The single definition of how the session cookie is set
 * (`PRODUCTION-READINESS-2026-07-31.md` A7).
 *
 * These options were previously duplicated verbatim in `src/app/api/v1/auth/login/route.ts`
 * and `src/app/login/actions.ts`. Two copies of a security control is one copy waiting to
 * diverge — a change to either would have silently left the other on the old setting, with
 * nothing to catch it. Both call sites now read from here.
 *
 * ## `SameSite=Strict`, up from `Lax`
 *
 * `Lax` already blocks cross-site POST, which covers the mutating REST endpoints. It does
 * NOT cover top-level GET navigation, and A7 raises this specifically because the UI
 * introduces **server actions** — same-origin POSTs, a well-known CSRF target class.
 * `Strict` withholds the cookie on every cross-site request including top-level navigation.
 *
 * **The cost, stated plainly:** following a link into QAMS from anywhere else — an email, a
 * chat message, a ticket — arrives without the cookie and lands the user on `/login` even
 * though they are signed in. Clicking through a second time works, because by then the
 * navigation is same-site. That is a real, visible annoyance. It is acceptable for an
 * internal tool that people reach by bookmark, and it is trivially reversible: change this
 * one word.
 *
 * `docs/` says nothing about SameSite anywhere, so this tightens an undocumented
 * implementation choice; it does not set policy. If deep links from email turn out to
 * matter, that is a QA Lead decision and reverting is a one-line change in one file.
 *
 * `secure` follows `NODE_ENV` rather than being hard-coded, because a `Secure` cookie is
 * never stored over plain `http` and local development has no TLS.
 */
export function sessionCookieOptions(
  env: Record<string, string | undefined> = process.env
): SessionCookieOptions {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS
  };
}

export function verifySessionCookieValue(token: string | undefined | null): string | null {
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, expiresAtRaw, signature] = parts;

  const payload = `${userId}.${expiresAtRaw}`;
  const expected = sign(payload);
  const expectedBuffer = Buffer.from(expected, "hex");
  const suppliedBuffer = Buffer.from(signature, "hex");
  if (expectedBuffer.length !== suppliedBuffer.length || !timingSafeEqual(expectedBuffer, suppliedBuffer)) {
    return null;
  }

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return null;

  return userId;
}
