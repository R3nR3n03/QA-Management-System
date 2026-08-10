import { createHmac, randomBytes, timingSafeEqual } from "crypto";

/**
 * The OAuth `state` parameter for the Jira connect flow.
 *
 * ## What this defends against
 *
 * Without `state`, anyone who can make a signed-in victim's browser reach the callback URL
 * with their OWN authorization code binds THEIR Jira account to the victim's QAMS user.
 * Every subsequent transition the victim causes is then written to Jira as the attacker,
 * and the victim's audit trail says they did it. That is a login-CSRF, and it is the reason
 * a "Connect" link that omits `state` is a hole rather than a shortcut.
 *
 * ## Why signed rather than stored
 *
 * The obvious alternative is a random value in a server-side table checked on return. This
 * project has no such table and no session store — the session cookie is itself a stateless
 * signed token (`src/lib/session.ts`) — so a signed, self-describing state keeps the same
 * shape as the mechanism already here, and adds no schema.
 *
 * The cost, stated plainly: single-use is enforced by the ten-minute lifetime, not by
 * consumption. Inside that window the same state could be replayed. Closing that needs a
 * used-nonce store, which is a schema change and a cleanup job; the nonce is already carried
 * here so it can be added without changing the format.
 *
 * Format: `<nonce>.<userId>.<issuedAt>.<hmac>` — hex and base64url only, so it survives a
 * query string without escaping.
 */

/** Long enough that guessing one is not a strategy. */
const NONCE_BYTES = 16;

/**
 * How long a consent round trip may take. Ten minutes is generous for "click Connect,
 * approve in Jira, come back" and short enough that a leaked state is stale quickly.
 */
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export type OAuthState = {
  nonce: string;
  userId: string;
  issuedAt: number;
};

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/** Issues a fresh state for one user. Distinct on every call. */
export function createOAuthState(userId: string, secret: string, now: number = Date.now()): string {
  const nonce = randomBytes(NONCE_BYTES).toString("hex");
  const payload = `${nonce}.${userId}.${now}`;
  return `${payload}.${sign(payload, secret)}`;
}

/**
 * Splits a state without verifying it. Exported for tests and diagnostics; callers deciding
 * whether to trust a callback must use `verifyOAuthState`.
 */
export function parseOAuthState(raw: string): OAuthState | null {
  const parts = raw.split(".");
  if (parts.length !== 4) return null;

  const [nonce, userId, issuedAtRaw] = parts;
  const issuedAt = Number(issuedAtRaw);
  if (nonce === "" || userId === "" || !Number.isInteger(issuedAt)) return null;

  return { nonce, userId, issuedAt };
}

/**
 * Verifies signature and freshness, returning the state or `null`.
 *
 * `null` for every failure — forged, tampered, malformed, expired, or issued in the future.
 * The caller cannot act differently on any of them and telling them apart would only give an
 * attacker a signal.
 */
export function verifyOAuthState(
  raw: string,
  secret: string,
  now: number = Date.now()
): OAuthState | null {
  const parsed = parseOAuthState(raw);
  if (!parsed) return null;

  const parts = raw.split(".");
  const supplied = parts[3];
  const expected = sign(`${parsed.nonce}.${parsed.userId}.${parsed.issuedAt}`, secret);

  const suppliedBuffer = Buffer.from(supplied, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  // Constant-time, matching `verifySessionCookieValue`: a length check first, because
  // timingSafeEqual throws on a mismatch.
  if (
    suppliedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(suppliedBuffer, expectedBuffer)
  ) {
    return null;
  }

  // A state stamped in the future is either a clock problem or a forgery attempt with a
  // known-good signature; neither is a thing to accept.
  if (parsed.issuedAt > now) return null;
  if (now - parsed.issuedAt > OAUTH_STATE_TTL_MS) return null;

  return parsed;
}
