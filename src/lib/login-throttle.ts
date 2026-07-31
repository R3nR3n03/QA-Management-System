import { type HeaderReader, clientKey, emailKey } from "./client-key";
import { type RateLimiter, authLimiter } from "./rate-limit";

/**
 * What a sign-in attempt costs, and which failures cost what
 * (`PRODUCTION-READINESS-2026-07-31.md` A3).
 *
 * `rate-limit.ts` counts. This decides what is worth counting, and it is the ONLY place
 * that decides — both entry points to the credential check (`POST /api/v1/auth/login` and
 * the `signIn` server action) drive the same three operations in the same order. That
 * matters more than it looks: while these two paths open-coded their own sequence, one
 * short-circuited and the other did not, so the same attack was metered differently
 * depending on which door it came through.
 *
 * ## The protocol — three steps, both call sites, this order
 *
 * 1. `clientAllowed(headers)` — PEEK the client bucket. Refuse if it is already tripped.
 *    Costs nothing, so a flood of already-refused requests cannot deepen its own hole, and
 *    the REST route can run this before it even parses the body.
 * 2. `consumeEmail(email)` — SPEND one unit of the account's allowance. Every attempt pays,
 *    win or lose.
 * 3. `recordFailure(headers)` — SPEND one unit of the client's allowance, and ONLY once
 *    authentication has actually failed.
 *
 * ## Why the two dimensions are counted differently
 *
 * They are not the same kind of control and pretending otherwise makes both worse.
 *
 * **The client key is weak and shared.** Next fills `x-forwarded-for` from the socket peer
 * only when the caller did not send one (`base-server.js:568`, `??=`), so an attacker sets
 * the header and walks away from this dimension entirely — verified at runtime. Meanwhile
 * the people who genuinely cannot escape it are legitimate users behind one NAT egress
 * address, or behind a proxy that sets no `x-forwarded-for` of its own so every request
 * arrives bearing the proxy's address. Counting successes here means the eleventh
 * SUCCESSFUL sign-in of the window locks out an entire office, while the attacker it was
 * aimed at is unaffected. That is a control that costs honest users more than adversaries,
 * which is worse than no control. Failures-only keeps the brute-force friction and removes
 * the self-inflicted outage.
 *
 * **The email key is the one that actually holds.** It cannot be rotated without giving up
 * the account being attacked, so it survives header forgery — and when it locks, it locks
 * exactly the account under attack, which is the account that should be locked. It counts
 * EVERY attempt, deliberately: an attacker who happens to guess correctly on attempt nine
 * must still have paid for attempts one through eight, and a valid password submitted in
 * the middle of a spray must not silently refund the allowance. Do not "fix" this to match
 * the client dimension; the asymmetry is the point.
 *
 * ## Known gaps, stated rather than hidden
 *
 * - Step 1 refuses without reaching step 2, so a tripped client bucket stops that client's
 *   attempts from accruing against the email bucket. Harmless: nothing is being tried, so
 *   there is nothing for the account counter to record, and an attacker who rotates the
 *   header to get past step 1 resumes paying at step 2 immediately.
 * - Both counters are in-memory and per process. See `rate-limit.ts`.
 */

export type LoginThrottle = {
  /** Step 1. Non-consuming. False when this client is already locked out. */
  clientAllowed(headers: HeaderReader): boolean;
  /** Step 2. Consuming. False when this account has spent its allowance. */
  consumeEmail(email: string): boolean;
  /** Step 3. Consuming, and only ever called after authentication has failed. */
  recordFailure(headers: HeaderReader): void;
};

/**
 * Built over an injected limiter so the accounting can be tested against a hand-cranked
 * clock, with no shared state between tests and no dependence on the deployed limits.
 */
export function createLoginThrottle(limiter: RateLimiter): LoginThrottle {
  return {
    clientAllowed(headers: HeaderReader): boolean {
      return limiter.peek(clientKey(headers)).allowed;
    },

    consumeEmail(email: string): boolean {
      return limiter.consume(emailKey(email)).allowed;
    },

    recordFailure(headers: HeaderReader): void {
      limiter.consume(clientKey(headers));
    }
  };
}

/** The instance both login entry points use. Bound to the process-wide `authLimiter`. */
export const loginThrottle: LoginThrottle = createLoginThrottle(authLimiter);

/**
 * Which bucket refused an attempt, for the operational log ONLY.
 *
 * Never returned to a client: telling a caller which dimension tripped hands them a map of
 * the defence, and distinguishing "this account is locked" from "your address is locked"
 * is an account-enumeration oracle. It exists because the alternative — an `AUTH_FAILED`
 * line reading only "Too many attempts" — leaves an operator unable to tell an attack from
 * an office full of people sharing one NAT address, which is precisely the incident this
 * feature can cause.
 *
 * Carries no identifying value: not the address, not the email, not the hash. The email is
 * hashed for a reason (`client-key.ts`) and the raw peer address must not start appearing
 * in logs by the back door either.
 */
export type ThrottleDimension = "client" | "email";

/** The developer-facing log message for a throttle rejection. Never user-facing copy. */
export function throttleLogMessage(dimension: ThrottleDimension): string {
  return `Rate limit tripped: ${dimension} bucket.`;
}
