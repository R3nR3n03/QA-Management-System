import { describe, expect, it } from "vitest";
import { createLoginThrottle, throttleLogMessage } from "./login-throttle";
import { createRateLimiter } from "./rate-limit";

/** A hand-cranked clock. No fake timers, no shared state between tests. */
function clock(start = 1_000) {
  let value = start;
  return {
    now: () => value,
    advance(ms: number) {
      value += ms;
    }
  };
}

function headers(forwardedFor: string) {
  return { get: (name: string) => (name === "x-forwarded-for" ? forwardedFor : null) };
}

function throttle(limit: number, time = clock()) {
  return {
    time,
    subject: createLoginThrottle(createRateLimiter({ limit, windowMs: 1000, now: time.now }))
  };
}

/**
 * Drives the same three-step protocol both login entry points run.
 *
 * READ THIS BEFORE TRUSTING IT: this helper is an INDEPENDENT re-implementation of that
 * sequence, so it does **not** catch call-site drift. `auth/login/route.ts` or
 * `login/actions.ts` could be rewritten to meter incorrectly and every test here would stay
 * green. What these tests pin is the behaviour of `login-throttle.ts` itself — that a
 * success spends no client allowance, that a failure does, and that the account dimension
 * charges both. That the two call sites actually drive it in this order is verified by hand
 * against a running server, and is recorded in
 * `.relay/runs/2026-07-31-production-blockers/rounds.md`.
 *
 * An earlier version of this comment claimed the tests failed on drift. They do not, and a
 * comment asserting a guarantee that does not exist is worse than no comment.
 */
function attempt(
  subject: ReturnType<typeof createLoginThrottle>,
  ip: string,
  email: string,
  succeeds: boolean
): "throttled" | "ok" | "rejected" {
  const h = headers(ip);
  if (!subject.clientAllowed(h)) return "throttled";
  if (!subject.consumeEmail(email)) return "throttled";
  if (succeeds) return "ok";
  subject.recordFailure(h);
  return "rejected";
}

describe("the client dimension counts failures only", () => {
  /**
   * THE regression this whole shape exists to prevent. The client key is shared by everyone
   * behind one NAT egress address, or behind a proxy that sets no x-forwarded-for of its
   * own. If successes spent it, the eleventh successful sign-in of the window would lock
   * out an entire office — while the attacker it was aimed at sets one header and walks
   * away (Next only backfills x-forwarded-for when it is absent).
   */
  it("never locks out a client that keeps signing in successfully", () => {
    const { subject } = throttle(3);

    for (let i = 0; i < 50; i += 1) {
      expect(attempt(subject, "203.0.113.1", `user${i}@example.com`, true)).toBe("ok");
    }
  });

  it("locks out a client that keeps failing", () => {
    const { subject } = throttle(3);

    // Distinct accounts each time, so only the client bucket can be what trips.
    expect(attempt(subject, "203.0.113.1", "a@example.com", false)).toBe("rejected");
    expect(attempt(subject, "203.0.113.1", "b@example.com", false)).toBe("rejected");
    expect(attempt(subject, "203.0.113.1", "c@example.com", false)).toBe("rejected");
    expect(attempt(subject, "203.0.113.1", "d@example.com", false)).toBe("throttled");
  });

  /**
   * A successful sign-in must not merely avoid tripping the bucket — it must not move it at
   * all, or a busy shared address still drifts into lockout, just more slowly.
   */
  it("leaves the client budget untouched by a success, not merely under the limit", () => {
    const { subject } = throttle(3);

    for (let i = 0; i < 20; i += 1) attempt(subject, "203.0.113.1", `ok${i}@example.com`, true);

    // The full failure budget is still there afterwards.
    expect(attempt(subject, "203.0.113.1", "a@example.com", false)).toBe("rejected");
    expect(attempt(subject, "203.0.113.1", "b@example.com", false)).toBe("rejected");
    expect(attempt(subject, "203.0.113.1", "c@example.com", false)).toBe("rejected");
    expect(attempt(subject, "203.0.113.1", "d@example.com", false)).toBe("throttled");
  });

  it("frees a locked-out client once the window has elapsed", () => {
    const { subject, time } = throttle(1);

    expect(attempt(subject, "203.0.113.1", "a@example.com", false)).toBe("rejected");
    expect(attempt(subject, "203.0.113.1", "b@example.com", false)).toBe("throttled");

    time.advance(1000);
    expect(attempt(subject, "203.0.113.1", "c@example.com", true)).toBe("ok");
  });

  it("keeps separate clients independent", () => {
    const { subject } = throttle(1);

    expect(attempt(subject, "203.0.113.1", "a@example.com", false)).toBe("rejected");
    expect(attempt(subject, "203.0.113.1", "b@example.com", false)).toBe("throttled");
    // A different peer is unaffected by the first one's failures.
    expect(attempt(subject, "198.51.100.9", "c@example.com", false)).toBe("rejected");
  });
});

describe("the email dimension counts every attempt", () => {
  /**
   * Deliberately NOT failures-only, unlike the client dimension. An attacker who guesses
   * correctly on attempt nine must still have paid for one through eight, and a valid
   * password submitted mid-spray must not refund the allowance. When this locks, it locks
   * the account actually under attack — which is the account that should be locked.
   */
  it("spends the account allowance on successes as well as failures", () => {
    const { subject } = throttle(3);

    // Rotating the client address, so only the email bucket can be what trips.
    expect(attempt(subject, "203.0.113.1", "target@example.com", true)).toBe("ok");
    expect(attempt(subject, "203.0.113.2", "target@example.com", true)).toBe("ok");
    expect(attempt(subject, "203.0.113.3", "target@example.com", true)).toBe("ok");
    expect(attempt(subject, "203.0.113.4", "target@example.com", true)).toBe("throttled");
  });

  /**
   * The dimension that actually holds. Next only fills x-forwarded-for when the caller sent
   * none, so an attacker rotating the header escapes the client bucket entirely — verified
   * at runtime. They cannot escape this one without abandoning the target account.
   */
  it("still stops an attacker who rotates the forgeable client header every request", () => {
    const { subject } = throttle(3);

    for (let i = 0; i < 3; i += 1) {
      expect(attempt(subject, `198.51.100.${i}`, "target@example.com", false)).toBe("rejected");
    }
    expect(attempt(subject, "198.51.100.99", "target@example.com", false)).toBe("throttled");
  });

  it("normalises case and whitespace, so one account is one bucket", () => {
    const { subject } = throttle(2);

    expect(attempt(subject, "203.0.113.1", "Target@Example.com", true)).toBe("ok");
    expect(attempt(subject, "203.0.113.2", "  target@example.com  ", true)).toBe("ok");
    expect(attempt(subject, "203.0.113.3", "TARGET@EXAMPLE.COM", true)).toBe("throttled");
  });

  it("keeps separate accounts independent", () => {
    const { subject } = throttle(1);

    expect(attempt(subject, "203.0.113.1", "a@example.com", true)).toBe("ok");
    expect(attempt(subject, "203.0.113.2", "a@example.com", true)).toBe("throttled");
    expect(attempt(subject, "203.0.113.3", "b@example.com", true)).toBe("ok");
  });
});

describe("the two dimensions share one budget but are spent differently", () => {
  /**
   * Documented consequence, asserted so it stays deliberate: a tripped client bucket
   * refuses at step 1, so those attempts never reach step 2 and never accrue against the
   * account. Harmless — nothing is being tried — and an attacker who rotates the header to
   * get past step 1 starts paying at step 2 immediately.
   */
  it("stops charging the account once the client is already locked out", () => {
    const { subject } = throttle(2);

    attempt(subject, "203.0.113.1", "a@example.com", false);
    attempt(subject, "203.0.113.1", "b@example.com", false);
    // Client is now locked; these are refused before the email bucket is touched.
    expect(attempt(subject, "203.0.113.1", "target@example.com", false)).toBe("throttled");
    expect(attempt(subject, "203.0.113.1", "target@example.com", false)).toBe("throttled");

    // Proof the account paid nothing: from a fresh address it still has its full budget.
    expect(attempt(subject, "198.51.100.1", "target@example.com", true)).toBe("ok");
    expect(attempt(subject, "198.51.100.2", "target@example.com", true)).toBe("ok");
    expect(attempt(subject, "198.51.100.3", "target@example.com", true)).toBe("throttled");
  });

  it("checks the client before spending anything on the account", () => {
    const { subject } = throttle(1);
    const h = headers("203.0.113.1");

    subject.recordFailure(h); // client now locked
    expect(subject.clientAllowed(h)).toBe(false);
    // The account is untouched, because step 1 refuses before step 2 runs.
    expect(subject.consumeEmail("target@example.com")).toBe(true);
  });
});

describe("throttleLogMessage", () => {
  /**
   * Operational log only, never a response. It names the dimension so an operator can tell
   * an attack from an office sharing one NAT address — and carries no address, no email and
   * no hash, because the email is hashed for a reason.
   */
  it("names the dimension and nothing identifying", () => {
    expect(throttleLogMessage("client")).toBe("Rate limit tripped: client bucket.");
    expect(throttleLogMessage("email")).toBe("Rate limit tripped: email bucket.");
  });
});
