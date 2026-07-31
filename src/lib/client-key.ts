import { createHash } from "crypto";

/**
 * The keys the rate limiter counts against (`PRODUCTION-READINESS-2026-07-31.md` A3).
 *
 * ## `clientKey` is a speed bump, not an authenticated control — read this before relying on it
 *
 * A route handler never sees the TCP peer address directly, but it is NOT true that the
 * key is therefore shared or absent. Next backfills the header itself — for a Node request,
 * and only when the header is absent — in `node_modules/next/dist/server/base-server.js:568`:
 *
 * ```js
 * req.headers['x-forwarded-for'] ??= originalRequest?.socket?.remoteAddress;
 * ```
 *
 * So under `next start` with no proxy at all, a handler still sees an `x-forwarded-for`
 * carrying the socket peer address, and this key is **per peer**. Verified at runtime:
 * with the `::1` bucket fully tripped, a request arriving over the LAN interface — a
 * different peer, sending no header of its own — got a clean bucket. `SHARED_CLIENT_KEY`
 * is a genuine fallback for topologies where nothing supplies an address, not the normal
 * case.
 *
 * The weakness is the `??=`. It fills the header only when it is ABSENT, so a caller who
 * SENDS one always wins, and Next never overwrites it. Verified at runtime: immediately
 * after exhausting the real bucket, a forged `x-forwarded-for: 9.9.9.9` was allowed
 * straight through. One header defeats this dimension completely.
 *
 * What would make it trustworthy is a reverse proxy that OVERWRITES `x-forwarded-for` with
 * the address it observed, before the request reaches the app — deployment topology (D1),
 * which does not exist here. Until it does, this dimension is friction against a naive
 * attacker who does not think to set a header, and nothing more.
 *
 * That is why the real weight sits on `emailKey`: an attacker cannot rotate it without
 * abandoning the account being attacked. It is also why the client dimension is spent on
 * FAILED attempts only (`src/lib/login-throttle.ts`) — a control an attacker escapes with
 * one header must not be one that legitimate users, who share an address via NAT or a
 * proxy that sets no header of its own, can exhaust by signing in successfully.
 *
 * `MAX_TRACKED_KEYS` in `rate-limit.ts` is the other half of that acceptance: a forgeable
 * key is also an unbounded-memory vector, and the overflow bucket bounds it.
 *
 * ## Why the email is hashed
 *
 * `src/app/api/v1/auth/login/route.ts` deliberately does NOT log the attempted email — no
 * document establishes a policy for handling personal data, and inventing one is not this
 * change's to make. A raw email held as a map key in a long-lived process would quietly
 * undo that, and any future decision to dump limiter state would leak an account list.
 * SHA-256 keeps the bucket per-account without keeping the account.
 *
 * Every function here is pure.
 */

/** Anything with a `get` — a `Headers`, or Next's `ReadonlyHeaders`. Keeps this testable. */
export type HeaderReader = { get(name: string): string | null | undefined };

/**
 * The bucket every caller shares when no forwarded address is present at all.
 *
 * Shared, not per-request-unique, and that is the restrictive direction on purpose: an
 * unidentifiable caller must not get a private allowance simply by sending no headers.
 *
 * Reaching it is the exception, not the rule: Next backfills `x-forwarded-for` from the
 * socket peer address (see above), so under `next start` a caller normally has its own
 * bucket. This covers the cases where that backfill yields nothing — a non-Node request
 * adapter, or a socket with no `remoteAddress`.
 */
export const SHARED_CLIENT_KEY = "client:unknown";

/**
 * The first hop of an `X-Forwarded-For` list — the original client, per RFC 7239's
 * convention, with each proxy appending to the right.
 *
 * Null when absent or blank. Not validated as an IP address: an unparseable value is
 * still a stable-ish grouping key, and rejecting it would just push that caller into the
 * shared bucket, which is where a forged value effectively belongs anyway.
 */
export function parseForwardedFor(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const first = raw.split(",")[0]?.trim() ?? "";
  return first === "" ? null : first;
}

/** `x-forwarded-for` first hop, then `x-real-ip`, then the shared bucket. */
export function clientKey(headers: HeaderReader): string {
  const forwarded = parseForwardedFor(headers.get("x-forwarded-for"));
  if (forwarded !== null) return `client:${forwarded}`;

  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return `client:${realIp}`;

  return SHARED_CLIENT_KEY;
}

/**
 * A stable, non-reversible bucket key for an email address.
 *
 * Trimmed and lowercased first, so `Ada@Example.com ` and `ada@example.com` are one
 * account to the limiter and not two allowances. Uses Node's `crypto` — every call site
 * is a route handler or server action on the Node runtime. Do NOT import this from
 * `middleware.ts`, which runs on Edge.
 */
export function emailKey(email: string): string {
  const normalised = email.trim().toLowerCase();
  return `email:${createHash("sha256").update(normalised).digest("hex")}`;
}
