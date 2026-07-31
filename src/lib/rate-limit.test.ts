import { describe, expect, it } from "vitest";
import { AppError } from "./errors";
import {
  DEFAULT_RATE_LIMIT_AUTH_MAX,
  DEFAULT_RATE_LIMIT_AUTH_WINDOW_MS,
  DEFAULT_RATE_LIMIT_IMPORT_MAX,
  DEFAULT_RATE_LIMIT_IMPORT_WINDOW_MS,
  assertWithinRateLimit,
  authRateLimitConfig,
  createRateLimiter,
  importRateLimitConfig,
  parseAuthMax,
  parseAuthWindowMs,
  parseImportMax,
  parseImportWindowMs,
  rateLimitError
} from "./rate-limit";

/** Every unusable value a deployer could plausibly put in the environment. */
const BAD_INPUTS = [undefined, "", "   ", "abc", "0", "-1", "1.5", "NaN", "Infinity"];

/** A hand-cranked clock. No fake timers, no async, nothing global to restore. */
function clock(start = 1_000) {
  let value = start;
  return {
    now: () => value,
    advance(ms: number) {
      value += ms;
    }
  };
}

describe("createRateLimiter", () => {
  it("allows exactly `limit` attempts in a window and counts down remaining", () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 1000, now: clock().now });

    expect(limiter.consume("a")).toMatchObject({ allowed: true, remaining: 2 });
    expect(limiter.consume("a")).toMatchObject({ allowed: true, remaining: 1 });
    expect(limiter.consume("a")).toMatchObject({ allowed: true, remaining: 0 });
  });

  it("denies the attempt after the limit, and stays denied inside the window", () => {
    const time = clock();
    const limiter = createRateLimiter({ limit: 2, windowMs: 1000, now: time.now });

    limiter.consume("a");
    limiter.consume("a");
    expect(limiter.consume("a").allowed).toBe(false);

    time.advance(999);
    expect(limiter.consume("a").allowed).toBe(false);
  });

  it("reports the moment the window resets", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 5000, now: clock(1000).now });
    expect(limiter.consume("a").resetAt).toBe(6000);
  });

  it("starts a fresh window once the old one has elapsed", () => {
    const time = clock();
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: time.now });

    expect(limiter.consume("a").allowed).toBe(true);
    expect(limiter.consume("a").allowed).toBe(false);

    time.advance(1000);
    expect(limiter.consume("a").allowed).toBe(true);
  });

  it("keeps distinct keys independent", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: clock().now });

    expect(limiter.consume("a").allowed).toBe(true);
    expect(limiter.consume("b").allowed).toBe(true);
    expect(limiter.consume("a").allowed).toBe(false);
    expect(limiter.consume("b").allowed).toBe(false);
  });

  /**
   * The keys are attacker-supplied, so an unbounded map is itself a denial-of-service
   * vector. Past the ceiling, new keys collapse into one shared bucket — the restrictive
   * direction. A rotating attacker must not be able to mint a fresh allowance per request.
   */
  it("collapses keys past maxKeys into one shared bucket rather than growing", () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 1000, now: clock().now, maxKeys: 2 });

    limiter.consume("tracked-1");
    limiter.consume("tracked-2");

    // Both of these are new keys arriving at a full map, so they share one counter.
    expect(limiter.consume("rotating-1").allowed).toBe(true);
    expect(limiter.consume("rotating-2").allowed).toBe(true);
    expect(limiter.consume("rotating-3").allowed).toBe(false);
  });

  it("still gives an already-tracked key its own bucket once the map is full", () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 1000, now: clock().now, maxKeys: 1 });

    expect(limiter.consume("known").allowed).toBe(true);
    limiter.consume("other"); // overflow
    limiter.consume("other"); // overflow, at the limit
    expect(limiter.consume("known").allowed).toBe(true);
  });

  it("frees swept keys, so a quiet period lets new keys be tracked again", () => {
    const time = clock();
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: time.now, maxKeys: 1 });

    limiter.consume("first");
    time.advance(1000);

    // "first" has expired and been swept, so "second" takes the freed slot as its own
    // bucket. The proof is that "third" — arriving at a now-full map — still gets a
    // fresh overflow bucket; had "second" itself gone to overflow, "third" would have
    // found that bucket already at the limit and been denied.
    expect(limiter.consume("second").allowed).toBe(true);
    expect(limiter.consume("third").allowed).toBe(true);
  });
});

describe("peek", () => {
  it("reports the state without spending anything", () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 1000, now: clock().now });

    // Peeking a thousand times must not move the counter one unit.
    for (let i = 0; i < 1000; i += 1) expect(limiter.peek("a").allowed).toBe(true);

    expect(limiter.consume("a")).toMatchObject({ allowed: true, remaining: 1 });
    expect(limiter.consume("a")).toMatchObject({ allowed: true, remaining: 0 });
    expect(limiter.consume("a").allowed).toBe(false);
  });

  it("reads an untracked key as a full, fresh allowance", () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 1000, now: clock(1000).now });
    expect(limiter.peek("never-seen")).toEqual({ allowed: true, remaining: 3, resetAt: 2000 });
  });

  it("turns false exactly when the next consume would be denied", () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 1000, now: clock().now });

    limiter.consume("a");
    expect(limiter.peek("a").allowed).toBe(true);
    limiter.consume("a"); // now at the limit
    expect(limiter.peek("a").allowed).toBe(false);
  });

  it("reads as allowed again once the window has elapsed", () => {
    const time = clock();
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: time.now });

    limiter.consume("a");
    expect(limiter.peek("a").allowed).toBe(false);

    time.advance(1000);
    expect(limiter.peek("a").allowed).toBe(true);
  });

  /**
   * Peeking must not be a way to grow the map: the keys are attacker-supplied, and the
   * client dimension is peeked on EVERY request, including ones that go on to succeed.
   */
  it("creates no bucket, so peeking an unbounded stream of keys costs nothing", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: clock().now, maxKeys: 1 });

    for (let i = 0; i < 100; i += 1) limiter.peek(`rotating-${i}`);

    // If any of those had been recorded, this first real key would have hit a full map
    // and landed in the shared overflow bucket instead of getting its own.
    expect(limiter.consume("real").allowed).toBe(true);
    expect(limiter.consume("real").allowed).toBe(false);
    expect(limiter.peek("real").allowed).toBe(false);
  });
});

describe("rate limit configuration", () => {
  it("uses configured integers", () => {
    expect(parseAuthMax("25")).toBe(25);
    expect(parseAuthWindowMs("60000")).toBe(60000);
    expect(parseImportMax("2")).toBe(2);
    expect(parseImportWindowMs("1000")).toBe(1000);
  });

  /**
   * A misconfiguration must never DISABLE the throttle. Every rejected input falls back
   * to the default, which is the restrictive direction. "0" is treated as unusable on
   * purpose: it reads like "off", and off is exactly what must not be reachable by typo.
   */
  it("falls back to the default for anything unusable, never to unlimited", () => {
    for (const bad of BAD_INPUTS) {
      expect(parseAuthMax(bad)).toBe(DEFAULT_RATE_LIMIT_AUTH_MAX);
      expect(parseAuthWindowMs(bad)).toBe(DEFAULT_RATE_LIMIT_AUTH_WINDOW_MS);
      expect(parseImportMax(bad)).toBe(DEFAULT_RATE_LIMIT_IMPORT_MAX);
      expect(parseImportWindowMs(bad)).toBe(DEFAULT_RATE_LIMIT_IMPORT_WINDOW_MS);
    }
  });

  it("reads the four variables from the supplied environment", () => {
    expect(
      authRateLimitConfig({ RATE_LIMIT_AUTH_MAX: "4", RATE_LIMIT_AUTH_WINDOW_MS: "5000" })
    ).toEqual({ limit: 4, windowMs: 5000 });

    expect(
      importRateLimitConfig({ RATE_LIMIT_IMPORT_MAX: "1", RATE_LIMIT_IMPORT_WINDOW_MS: "9000" })
    ).toEqual({ limit: 1, windowMs: 9000 });

    expect(authRateLimitConfig({})).toEqual({
      limit: DEFAULT_RATE_LIMIT_AUTH_MAX,
      windowMs: DEFAULT_RATE_LIMIT_AUTH_WINDOW_MS
    });
    expect(importRateLimitConfig({})).toEqual({
      limit: DEFAULT_RATE_LIMIT_IMPORT_MAX,
      windowMs: DEFAULT_RATE_LIMIT_IMPORT_WINDOW_MS
    });
  });

  it("defaults to 10 attempts per 15 minutes, and 5 imports per hour", () => {
    expect(DEFAULT_RATE_LIMIT_AUTH_MAX).toBe(10);
    expect(DEFAULT_RATE_LIMIT_AUTH_WINDOW_MS).toBe(900000);
    expect(DEFAULT_RATE_LIMIT_IMPORT_MAX).toBe(5);
    expect(DEFAULT_RATE_LIMIT_IMPORT_WINDOW_MS).toBe(3600000);
  });
});

describe("rateLimitError", () => {
  /**
   * 403 UNAUTHORIZED, not 429 RATE_LIMITED. docs/business-rules-and-validation.md:5
   * enumerates 422/403/404/409 only and ErrorCode has no rate-limit member; adding
   * either is a documented policy change. This test pins the decision so a change to it
   * is a deliberate one.
   */
  it("reuses the documented 403 UNAUTHORIZED pairing", () => {
    const error = rateLimitError();
    expect(error).toBeInstanceOf(AppError);
    expect(error.status).toBe(403);
    expect(error.code).toBe("UNAUTHORIZED");
    expect(error.field).toBeUndefined();
    // The message is the only thing distinguishing this from a wrong password.
    expect(error.message).toBe("Too many attempts. Try again later.");
  });
});

describe("assertWithinRateLimit", () => {
  it("passes an allowed decision", () => {
    expect(() =>
      assertWithinRateLimit({ allowed: true, remaining: 0, resetAt: 0 })
    ).not.toThrow();
  });

  it("throws the rate limit AppError on a denial", () => {
    let thrown: unknown;
    try {
      assertWithinRateLimit({ allowed: false, remaining: 0, resetAt: 123 });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AppError);
    const error = thrown as AppError;
    expect(error.status).toBe(403);
    expect(error.code).toBe("UNAUTHORIZED");
    expect(error.message).toBe("Too many attempts. Try again later.");
  });
});
