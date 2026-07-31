import { AppError } from "./errors";

/**
 * Request throttling for the authentication and import endpoints.
 *
 * `docs/api-and-security.md:43` requires it — "Rate limit authentication and import
 * endpoints" — and nothing implemented it (`PRODUCTION-READINESS-2026-07-31.md` A3).
 * `POST /api/v1/auth/login` accepted unlimited credential attempts, and the `signIn`
 * server action added a second unthrottled entry point to the same credential check.
 *
 * THE THRESHOLDS ARE NOT POLICY. `docs/api-and-security.md:43` places the exact limits
 * outside the knowledge base ("Exact limits are deployment policy and are not defined
 * here."). The four defaults below are deployment defaults, not documented rules, and
 * want QA Lead confirmation before anything is deployed.
 *
 * ## What this is, and what it is not
 *
 * A **fixed window** counter, not a token bucket and not a sliding window. A caller who
 * spends the whole allowance at the end of one window and the whole allowance at the
 * start of the next gets 2x the limit across that boundary. That is the accepted cost of
 * a design with no dependency and no storage; say it plainly rather than implying a
 * smoothness this does not have.
 *
 * **In memory, therefore per process.** N instances behind a load balancer give N times the
 * limit; a restart clears every counter. This is a speed bump against naive brute force,
 * not a distributed control. A shared store (Redis, or a Postgres table) is the honest fix
 * and is a deployment decision this repository does not get to make.
 *
 * "Per process" is only true because the singletons at the foot of this file are pinned to
 * `globalThis`. They are not plain module constants, and the comment there explains why —
 * a module-scope map would be per *bundle*, which is narrower than per process and was a
 * real bypass.
 *
 * ## This module counts; it does not decide what is worth counting
 *
 * `peek` and `consume` are separate operations precisely so a caller can refuse an
 * already-tripped key without spending anything on that refusal. WHICH events cost a key
 * its allowance is a policy decision, and for sign-in it lives in
 * `src/lib/login-throttle.ts` — the one place both login entry points share. Read that
 * file before reasoning about what the auth limiter actually counts.
 *
 * ## Error shape — deliberate, and revisitable in one line
 *
 * A throttled caller gets `403 UNAUTHORIZED`, not `429`. `docs/business-rules-and-
 * validation.md:5` (the top authority) enumerates 422/403/404/409 only; `429` appears
 * nowhere in `docs/`, and `ErrorCode` has no rate-limit member. Adding either is a policy
 * change that requires a `docs/` edit, which this change is not permitted to make.
 *
 * The consequence, stated honestly: on `/auth/login` a throttled response is
 * indistinguishable from a wrong password to a client reading only the code. That removes
 * an enumeration oracle (good) and shows generic "unauthorized" copy to a locked-out real
 * user (bad). The distinct `message` still reaches API clients. There is no `Retry-After`
 * header — `asErrorResponse` sets no headers at all.
 *
 * `rateLimitError()` is the ONLY place that status, code and message are decided. Moving
 * to `429 RATE_LIMITED` after QA Lead approval is a one-line change here, plus one entry
 * in `src/ui/error-copy.ts`, whose `Record<ErrorCode, ErrorCopy>` is exhaustive and would
 * otherwise fail typecheck.
 *
 * Everything except `assertWithinRateLimit` is pure, and the clock is injected, so the
 * whole module is testable without timers, a server, or an environment.
 */

/** The verdict for one consumed unit. `resetAt` is an epoch millisecond value. */
export type RateLimitDecision = {
  allowed: boolean;
  /** Attempts left in the current window after this one. Never negative. */
  remaining: number;
  resetAt: number;
};

export type RateLimiter = {
  /**
   * Reports whether `key` is currently within its limit WITHOUT spending anything.
   *
   * Non-mutating in every respect: it creates no bucket, increments no counter, and does
   * not sweep. An untracked or expired key reads as a full, fresh allowance. This exists
   * so a caller can refuse an already-tripped key up front while still choosing, later and
   * on its own terms, whether that particular attempt deserves to cost anything — see
   * `src/lib/login-throttle.ts`, where a successful sign-in costs the client bucket nothing.
   */
  peek(key: string): RateLimitDecision;
  /** Spends one unit against `key` and reports whether it was within the limit. */
  consume(key: string): RateLimitDecision;
};

export type RateLimiterOptions = {
  limit: number;
  windowMs: number;
  /** Injected so tests need no fake timers. Defaults to the wall clock. */
  now?: () => number;
  /** Overridable only so the overflow behaviour is testable at a small size. */
  maxKeys?: number;
};

/**
 * Ceiling on tracked keys. Every key is attacker-supplied (a forgeable header, or an
 * email address), so an unbounded map is itself a memory-exhaustion vector — the same
 * class of problem as A2. Past the ceiling, new keys share ONE bucket: the restrictive
 * direction, because a key-rotating attacker collapses into a single counter instead of
 * minting a fresh allowance per request. The cost is that a flood can push unrelated
 * callers into that shared bucket, which is the correct trade under attack.
 */
export const MAX_TRACKED_KEYS = 10_000;

/** The bucket every key past `MAX_TRACKED_KEYS` shares. Not a valid caller key. */
export const OVERFLOW_KEY = "__overflow__";

/** 10 attempts. A deployment default, not a documented policy value — see above. */
export const DEFAULT_RATE_LIMIT_AUTH_MAX = 10;
/** 15 minutes. A deployment default, not a documented policy value. */
export const DEFAULT_RATE_LIMIT_AUTH_WINDOW_MS = 15 * 60 * 1000;
/** 5 imports. A deployment default, not a documented policy value. */
export const DEFAULT_RATE_LIMIT_IMPORT_MAX = 5;
/** 1 hour. A deployment default, not a documented policy value. */
export const DEFAULT_RATE_LIMIT_IMPORT_WINDOW_MS = 60 * 60 * 1000;

/**
 * Shared parser for all four settings. An absent, non-numeric, non-integer, zero or
 * negative value falls back to the supplied default rather than throwing.
 *
 * Falling back is safe *because every default is the restrictive direction*: a typo can
 * fail to tighten the throttle, it can never remove it. A fallback that disabled the
 * limiter on a bad value would be the wrong call, and `0` is treated as unusable for
 * exactly that reason — it reads like "off" and would be.
 */
export function parsePositiveInteger(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export function parseAuthMax(raw: string | undefined): number {
  return parsePositiveInteger(raw, DEFAULT_RATE_LIMIT_AUTH_MAX);
}

export function parseAuthWindowMs(raw: string | undefined): number {
  return parsePositiveInteger(raw, DEFAULT_RATE_LIMIT_AUTH_WINDOW_MS);
}

export function parseImportMax(raw: string | undefined): number {
  return parsePositiveInteger(raw, DEFAULT_RATE_LIMIT_IMPORT_MAX);
}

export function parseImportWindowMs(raw: string | undefined): number {
  return parsePositiveInteger(raw, DEFAULT_RATE_LIMIT_IMPORT_WINDOW_MS);
}

export type RateLimitConfig = { limit: number; windowMs: number };

export function authRateLimitConfig(
  env: Record<string, string | undefined> = process.env
): RateLimitConfig {
  return {
    limit: parseAuthMax(env.RATE_LIMIT_AUTH_MAX),
    windowMs: parseAuthWindowMs(env.RATE_LIMIT_AUTH_WINDOW_MS)
  };
}

export function importRateLimitConfig(
  env: Record<string, string | undefined> = process.env
): RateLimitConfig {
  return {
    limit: parseImportMax(env.RATE_LIMIT_IMPORT_MAX),
    windowMs: parseImportWindowMs(env.RATE_LIMIT_IMPORT_WINDOW_MS)
  };
}

/**
 * A fixed-window counter over an injected clock.
 *
 * Expired buckets are swept on every `consume`. That is O(tracked keys) per call, bounded
 * by `MAX_TRACKED_KEYS`, which at ten thousand entries is microseconds — and it is what
 * keeps the map from growing for the lifetime of the process. `peek` deliberately does not
 * sweep, because it deliberately mutates nothing; since only `consume` ever creates a
 * bucket, only `consume` needs to clean them up. There is no timer, no interval, and
 * nothing to shut down.
 */
export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const { limit, windowMs } = options;
  const now = options.now ?? (() => Date.now());
  const maxKeys = options.maxKeys ?? MAX_TRACKED_KEYS;
  const buckets = new Map<string, { count: number; resetAt: number }>();

  /** Where `key` is counted: its own bucket, or the shared overflow one. */
  function resolveKey(key: string): string {
    // A key already being tracked keeps its own bucket; only genuinely new keys
    // arriving at a full map collapse into the shared one.
    return buckets.has(key) || buckets.size < maxKeys ? key : OVERFLOW_KEY;
  }

  return {
    peek(key: string): RateLimitDecision {
      const at = now();
      const bucket = buckets.get(resolveKey(key));

      // Missing or expired reads as a full allowance. No bucket is created, so peeking at
      // an attacker-supplied key can never grow the map.
      if (bucket === undefined || bucket.resetAt <= at) {
        return { allowed: true, remaining: limit, resetAt: at + windowMs };
      }

      return {
        allowed: bucket.count < limit,
        remaining: Math.max(0, limit - bucket.count),
        resetAt: bucket.resetAt
      };
    },

    consume(key: string): RateLimitDecision {
      const at = now();

      for (const [tracked, bucket] of buckets) {
        if (bucket.resetAt <= at) buckets.delete(tracked);
      }

      const effectiveKey = resolveKey(key);

      let bucket = buckets.get(effectiveKey);
      if (bucket === undefined) {
        bucket = { count: 0, resetAt: at + windowMs };
        buckets.set(effectiveKey, bucket);
      }

      bucket.count += 1;
      return {
        allowed: bucket.count <= limit,
        remaining: Math.max(0, limit - bucket.count),
        resetAt: bucket.resetAt
      };
    }
  };
}

/**
 * The single source of truth for what a throttled caller is told. See the D-1 note at the
 * top of this file before changing the status or the code — both are constrained by
 * `docs/business-rules-and-validation.md:5`, and `src/ui/error-copy.ts` is exhaustive
 * over `ErrorCode`.
 */
export function rateLimitError(): AppError {
  return new AppError(403, "UNAUTHORIZED", "Too many attempts. Try again later.");
}

/** The one impure-in-spirit helper: turns a denial into the thrown `AppError`. */
export function assertWithinRateLimit(decision: RateLimitDecision): void {
  if (!decision.allowed) throw rateLimitError();
}

/**
 * Shared singletons, pinned to `globalThis`.
 *
 * WHY THIS IS NOT JUST `export const x = createRateLimiter(...)`, which is what it was:
 * Next compiles route handlers (the node layer) and pages/server actions (the react-server
 * layer) into **separate bundles**, and a module imported by both is instantiated **once
 * per bundle**. A module-scope `Map` therefore exists twice inside one process — so
 * `POST /api/v1/auth/login` and the `signIn` server action were counting into different
 * maps. An attacker alternating the two doors got `2 x RATE_LIMIT_AUTH_MAX` against a
 * single account per window, with no header forgery, defeating the one dimension
 * `login-throttle.ts` leans on. Verified in `.next/server/**`: the limiter's symbols appear
 * independently in `app/api/v1/auth/login/route.js`, `app/login/page.js` and
 * `app/api/v1/imports/workbook/route.js`.
 *
 * `src/lib/db.ts` uses this pattern for the Prisma client — but note the deliberate
 * difference: **db.ts assigns its global only when `NODE_ENV !== "production"`, and this
 * must NOT.** That gate is right for db.ts, whose purpose is surviving dev hot-reload. The
 * bundle split happens in production too, so gating this one on `NODE_ENV` would fix
 * development and ship the exact defect it exists to close. Do not "make it consistent
 * with db.ts" by adding the gate.
 *
 * The limits are still read once, at first construction; changing one means a restart.
 *
 * WHAT THIS STILL DOES NOT FIX: the counters live in one process's memory. N instances
 * behind a load balancer give N x the limit, and a restart clears every counter. That is a
 * speed bump against naive brute force, not a distributed control; a shared store (Redis,
 * or a Postgres table) is the honest fix and is a deployment decision this repository does
 * not get to make.
 *
 * Tests must build their own limiter with `createRateLimiter` rather than touching these,
 * so no test depends on another test's counters.
 */
declare global {
  var authLimiterGlobal: RateLimiter | undefined;
  var importLimiterGlobal: RateLimiter | undefined;
}

export const authLimiter: RateLimiter = (global.authLimiterGlobal ??= createRateLimiter(
  authRateLimitConfig()
));

export const importLimiter: RateLimiter = (global.importLimiterGlobal ??= createRateLimiter(
  importRateLimitConfig()
));
