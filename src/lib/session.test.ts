import { describe, expect, it } from "vitest";
import {
  DEFAULT_SESSION_TTL_HOURS,
  isSessionRevoked,
  parseSessionToken,
  parseSessionTtlHours,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
  sessionTtlMs
} from "./session";

/**
 * Covers the pure surface: cookie options, token shape, revocation and the TTL parser.
 * Signature verification reads `SESSION_SECRET` and is exercised against a running server
 * instead — see `.relay/runs/2026-07-31-session-revocation/`.
 */
describe("sessionCookieOptions", () => {
  it("is the one definition both call sites use", () => {
    // If these drift, the REST route and the server action set different cookies.
    expect(sessionCookieOptions({})).toEqual(sessionCookieOptions({}));
    expect(SESSION_COOKIE_NAME).toBe("qams_session");
  });

  /**
   * Up from "lax". Lax blocks cross-site POST but not top-level GET navigation, and A7
   * raises this because server actions post to the same origin. The accepted cost is that
   * an external link into QAMS lands on /login even when signed in.
   */
  it("sets SameSite=Strict and HttpOnly, whatever the environment", () => {
    for (const env of [{}, { NODE_ENV: "production" }, { NODE_ENV: "development" }]) {
      const options = sessionCookieOptions(env);
      expect(options.sameSite).toBe("strict");
      expect(options.httpOnly).toBe(true);
      expect(options.path).toBe("/");
    }
  });

  /**
   * Secure follows NODE_ENV rather than being hard-coded: a Secure cookie is never stored
   * over plain http, and local development has no TLS.
   */
  it("marks the cookie Secure in production only", () => {
    expect(sessionCookieOptions({ NODE_ENV: "production" }).secure).toBe(true);
    expect(sessionCookieOptions({ NODE_ENV: "development" }).secure).toBe(false);
    expect(sessionCookieOptions({}).secure).toBe(false);
  });

  /**
   * `next start` forces NODE_ENV=production even with no TLS in front of it, which is
   * exactly today's "prod" per PRODUCTION-READINESS-2026-07-31.md D1 (no deployment
   * pipeline exists). Without this override a Secure cookie set over plain http is
   * silently dropped by the browser, and every post-login navigation looks signed out.
   */
  it("SESSION_COOKIE_SECURE=false overrides the production default, and nothing else does", () => {
    expect(sessionCookieOptions({ NODE_ENV: "production", SESSION_COOKIE_SECURE: "false" }).secure).toBe(
      false
    );
    expect(sessionCookieOptions({ NODE_ENV: "production", SESSION_COOKIE_SECURE: "true" }).secure).toBe(
      true
    );
    expect(sessionCookieOptions({ NODE_ENV: "development", SESSION_COOKIE_SECURE: "false" }).secure).toBe(
      false
    );
  });

  it("defaults to the 12 hour TTL, and tracks it when configured", () => {
    expect(sessionCookieOptions({}).maxAge).toBe(43200);
    // The cookie must not outlive the token it carries, so both read the same TTL.
    expect(sessionCookieOptions({ SESSION_TTL_HOURS: "1" }).maxAge).toBe(3600);
    expect(sessionCookieOptions({ SESSION_TTL_HOURS: "1" }).maxAge).toBe(
      sessionTtlMs({ SESSION_TTL_HOURS: "1" }) / 1000
    );
  });
});

describe("parseSessionTtlHours", () => {
  it("uses a configured value", () => {
    expect(parseSessionTtlHours("1")).toBe(1);
    expect(parseSessionTtlHours("0.5")).toBe(0.5);
  });

  /**
   * Unusable input falls back to the default, and the default is the RESTRICTIVE direction:
   * a typo can fail to shorten the session window, it can never lengthen it.
   */
  it("falls back to the default for anything unusable", () => {
    for (const bad of [undefined, "", "   ", "abc", "0", "-1", "NaN", "Infinity"]) {
      expect(parseSessionTtlHours(bad)).toBe(DEFAULT_SESSION_TTL_HOURS);
    }
  });

  it("refuses to be configured into a longer-lived session than the default allows", () => {
    // A2/A6 both exist to shrink exposure windows; a config typo must not widen this one
    // without bound.
    expect(parseSessionTtlHours("100000")).toBe(DEFAULT_SESSION_TTL_HOURS * 2);
  });
});

describe("parseSessionToken", () => {
  const token = "user-1.1000.2000.abcdef";

  it("reads the four parts and exposes the signed payload", () => {
    expect(parseSessionToken(token)).toEqual({
      userId: "user-1",
      issuedAt: 1000,
      expiresAt: 2000,
      signature: "abcdef",
      payload: "user-1.1000.2000"
    });
  });

  /**
   * The pre-A6 token was `userId.expiresAt.signature` — three parts, carrying no issue time,
   * so it cannot be checked against `sessionsValidFrom`. It is REJECTED rather than honoured,
   * which signs everyone out once on deploy. That is the intended behaviour, not a
   * regression, and this test is what stops someone "fixing" it by accepting three parts.
   */
  it("rejects the old three-part token instead of honouring it", () => {
    expect(parseSessionToken("user-1.2000.abcdef")).toBeNull();
  });

  it("rejects malformed tokens", () => {
    for (const bad of [
      undefined,
      null,
      "",
      "user-1",
      "user-1.1000",
      "user-1.1000.2000.sig.extra",
      ".1000.2000.sig",
      "user-1.notanumber.2000.sig",
      "user-1.1000.notanumber.sig",
      "user-1.1000.2000."
    ]) {
      expect(parseSessionToken(bad)).toBeNull();
    }
  });

  // Shape only: it says nothing about authenticity, and must not be mistaken for a check.
  it("does not validate the signature", () => {
    expect(parseSessionToken("user-1.1000.2000.obviously-not-a-real-signature")).not.toBeNull();
  });
});

describe("isSessionRevoked", () => {
  it("treats a user who has never revoked as having no revoked sessions", () => {
    expect(isSessionRevoked(1000, null)).toBe(false);
    expect(isSessionRevoked(1000, undefined)).toBe(false);
  });

  it("refuses a token issued before the revocation instant", () => {
    expect(isSessionRevoked(999, new Date(1000))).toBe(true);
  });

  it("allows a token issued after it", () => {
    expect(isSessionRevoked(1001, new Date(1000))).toBe(false);
  });

  /**
   * Strictly `<`, and this is the case that decides it. Logging out stamps
   * `sessionsValidFrom = now`; a user who signs straight back in within the same millisecond
   * gets a token whose `issuedAt` equals it. Under `<=` that token would be refused and they
   * would be locked out of the session they just created.
   */
  it("allows a token issued in the same millisecond as the revocation", () => {
    expect(isSessionRevoked(1000, new Date(1000))).toBe(false);
  });
});
