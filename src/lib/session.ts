import { createHmac, timingSafeEqual } from "crypto";

export const SESSION_COOKIE_NAME = "qams_session";

/**
 * ## Session revocation (`PRODUCTION-READINESS-2026-07-31.md` A6)
 *
 * The cookie is a stateless signed token, so before this there was **no way to invalidate
 * one**. `POST /auth/logout` deleted the client's copy; anyone holding a duplicate kept a
 * working session for the remainder of its TTL, and the only way to kill a leaked cookie
 * was rotating `SESSION_SECRET`, which signs out every user at once.
 *
 * The fix carries an **issue time** in the token and compares it against
 * `User.sessionsValidFrom`. Logging out stamps that column with the current instant, so
 * every token issued before it — every copy, everywhere — is refused on its next request.
 *
 * ### Why a column on `User` and not a `Session` table
 *
 * `docs/data-model.md` § "Identity, configuration, and audit" enumerates the entities:
 * User, Controlled value, Audit event, Import run. **A `Session` entity is not among them**,
 * and inventing one is a data-model change that only the QA Lead can approve. A nullable
 * infrastructure column on an already-documented entity is a different act — `User` already
 * carries `version`, `createdAt`, `createdBy`, `updatedAt` and `updatedBy`, none of which
 * appear in that document's required-attribute list either.
 *
 * **What this therefore does NOT deliver, and nobody should assume it does:** revocation is
 * all-or-nothing *per user*. There is no per-device sign-out, and no register of who was
 * signed in when — both genuinely need the table. That remains an open QA Lead question;
 * shipping this column does not pre-empt it, and the column is not wasted if the table
 * later arrives.
 */

/** 12 hours — the pre-existing behaviour, kept as the default so nothing changes silently. */
export const DEFAULT_SESSION_TTL_HOURS = 12;

/**
 * Reads `SESSION_TTL_HOURS`. Anything unusable falls back to the default, which is the
 * **restrictive** direction here: a typo can fail to shorten the window, it can never
 * lengthen it. `docs/` establishes no TTL, so this contradicts nothing — it exists so a
 * deployment can shrink the exposure A6 describes without a code change.
 */
export function parseSessionTtlHours(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_SESSION_TTL_HOURS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_SESSION_TTL_HOURS;
  return Math.min(parsed, DEFAULT_SESSION_TTL_HOURS * 2);
}

export function sessionTtlMs(env: Record<string, string | undefined> = process.env): number {
  return parseSessionTtlHours(env.SESSION_TTL_HOURS) * 60 * 60 * 1000;
}

function sessionSecret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value) {
    throw new Error("SESSION_SECRET is not configured.");
  }
  return value;
}

/**
 * The same secret, for signing other short-lived server-issued values — currently the Jira
 * OAuth `state` (`src/lib/oauth-state.ts`).
 *
 * Sharing it is deliberate: a second secret would be a second thing to configure, rotate and
 * forget, for values that live ten minutes. The consequence, stated plainly: rotating
 * `SESSION_SECRET` invalidates any Jira connect flow already in progress as well as signing
 * everyone out. Both recover by retrying, and neither loses data.
 */
export function sessionSigningSecret(): string {
  return sessionSecret();
}

function sign(payload: string): string {
  return createHmac("sha256", sessionSecret()).update(payload).digest("hex");
}

/**
 * `userId.issuedAt.expiresAt.signature` — four parts, up from three.
 *
 * **Every cookie issued by the previous build becomes invalid the moment this deploys**, so
 * everyone is signed out exactly once. That is deliberate: a 3-part token carries no issue
 * time, so it cannot be checked against `sessionsValidFrom` and there is no safe way to
 * honour it. `parseSessionToken` rejects it rather than guessing.
 */
export function createSessionCookieValue(userId: string, now: number = Date.now()): string {
  const expiresAt = now + sessionTtlMs();
  const payload = `${userId}.${now}.${expiresAt}`;
  return `${payload}.${sign(payload)}`;
}

export type ParsedSessionToken = {
  userId: string;
  /** Epoch ms the token was issued — the value `sessionsValidFrom` is compared against. */
  issuedAt: number;
  expiresAt: number;
  signature: string;
  /** The signed portion, for verification. */
  payload: string;
};

/**
 * Shape only — pure, no crypto and no clock, so it is testable on its own. A caller must
 * still verify the signature; this says nothing about authenticity.
 */
export function parseSessionToken(token: string | undefined | null): ParsedSessionToken | null {
  if (!token) return null;

  const parts = token.split(".");
  // A 3-part token is the old format. Rejected, not upgraded — see above.
  if (parts.length !== 4) return null;

  const [userId, issuedAtRaw, expiresAtRaw, signature] = parts;
  if (!userId || !signature) return null;

  const issuedAt = Number(issuedAtRaw);
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) return null;

  return { userId, issuedAt, expiresAt, signature, payload: `${userId}.${issuedAtRaw}.${expiresAtRaw}` };
}

/**
 * Pure. `null` means this user has never revoked, so nothing is refused.
 *
 * Strictly `<`, not `<=`, and the difference matters: logging out stamps
 * `sessionsValidFrom = now`, and a user who signs straight back in within the same
 * millisecond would get a token whose `issuedAt` equals it. `<=` would refuse that token and
 * lock them out of the session they just created. The cost of `<` is that a token issued in
 * the very same millisecond as the logout survives — a one-millisecond window, erring
 * toward not locking out a legitimate sign-in.
 */
export function isSessionRevoked(issuedAt: number, sessionsValidFrom: Date | null | undefined): boolean {
  if (!sessionsValidFrom) return false;
  return issuedAt < sessionsValidFrom.getTime();
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
 * `secure` follows `NODE_ENV` by default, because a `Secure` cookie is never stored over
 * plain `http` and local development has no TLS.
 *
 * `SESSION_COOKIE_SECURE=false` overrides that default for the one case `NODE_ENV` cannot
 * distinguish: a production *build* (`next start`, or `node .next/standalone/server.js`)
 * run without a TLS terminator in front of it — per `PRODUCTION-READINESS-2026-07-31.md`
 * D1, that is the only way this project's "prod" runs today. Without the override, the
 * cookie is marked `Secure`, the browser silently refuses to store it over `http://`, and
 * every navigation after login looks like a fresh unauthenticated request — for example
 * clicking a catalogue tree node bounces to `/login` instead of expanding it. Leave this
 * unset the moment a real deployment terminates TLS in front of the app; it is not a
 * substitute for that.
 */
export function sessionCookieOptions(
  env: Record<string, string | undefined> = process.env
): SessionCookieOptions {
  return {
    httpOnly: true,
    secure: env.SESSION_COOKIE_SECURE === "false" ? false : env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    // Derived from the same TTL the token carries, so the cookie cannot outlive the token
    // it holds — they would otherwise drift the moment SESSION_TTL_HOURS is set.
    maxAge: sessionTtlMs(env) / 1000
  };
}

/**
 * Verifies signature and expiry and returns the parsed token, or null.
 *
 * It returns the whole token rather than just the user id because the caller needs
 * `issuedAt` to check revocation — that check needs `sessionsValidFrom` from the database,
 * which this module deliberately does not reach for. Signature verification stays here;
 * `isSessionRevoked` is pure and lives beside it.
 */
export function verifySessionCookieValue(
  token: string | undefined | null,
  now: number = Date.now()
): ParsedSessionToken | null {
  const parsed = parseSessionToken(token);
  if (!parsed) return null;

  const expected = sign(parsed.payload);
  const expectedBuffer = Buffer.from(expected, "hex");
  const suppliedBuffer = Buffer.from(parsed.signature, "hex");
  if (expectedBuffer.length !== suppliedBuffer.length || !timingSafeEqual(expectedBuffer, suppliedBuffer)) {
    return null;
  }

  if (now > parsed.expiresAt) return null;

  return parsed;
}
