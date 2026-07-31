import { describe, expect, it } from "vitest";
import { SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS, sessionCookieOptions } from "./session";

/**
 * Covers only `sessionCookieOptions`, which is pure. The token functions read
 * `SESSION_SECRET` and are not exercised here.
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
      expect(options.maxAge).toBe(SESSION_MAX_AGE_SECONDS);
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

  it("expires the cookie with the 12 hour session TTL", () => {
    expect(SESSION_MAX_AGE_SECONDS).toBe(43200);
  });
});
