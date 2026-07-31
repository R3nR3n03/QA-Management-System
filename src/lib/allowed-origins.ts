/**
 * `ALLOWED_ORIGINS` for Next's server-action Origin check
 * (`PRODUCTION-READINESS-2026-07-31.md` A7).
 *
 * ## What this is honestly worth
 *
 * This is an ASSERTION, not a proof. Next's built-in Origin/Host comparison is the actual
 * CSRF defence for server actions; `allowedOrigins` only widens it to hostnames the app is
 * legitimately reached by but does not see itself as (a proxy or load balancer that
 * rewrites `Host`). The finding A7 raises is that the built-in check "should be verified
 * for your deployment topology rather than assumed" — and this repository has no deployed
 * hostname and no proxy, so nothing here can verify it. What this module delivers is the
 * knob, documented, wired, and defaulting to the safe position.
 *
 * ## Why an unset value omits the key entirely
 *
 * Handing Next an EMPTY array is not the same as handing it nothing. Omitting the key
 * leaves Next's default same-origin check exactly as it is; supplying an empty list is a
 * configuration statement whose behaviour is Next's business and could change between
 * minor versions. `serverActionsConfig()` returns `undefined` so the caller can spread
 * conditionally and the key never appears.
 *
 * The real defence against CSRF here remains `SameSite=Strict` on the session cookie
 * (`sessionCookieOptions()` in `src/lib/session.ts`), which is enforced by the browser and
 * does not depend on a topology that does not exist yet.
 *
 * Pure, and tested as such.
 */

/**
 * Splits a comma-separated list. Blank entries are dropped, whitespace trimmed, order
 * preserved, duplicates collapsed. No URL parsing: Next matches these against the `Host`
 * header, so they are hostnames (optionally with a port), not origins with a scheme —
 * validating them as URLs would reject correct values.
 */
export function parseAllowedOrigins(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === "") return [];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (trimmed !== "") seen.add(trimmed);
  }
  return [...seen];
}

export function allowedOrigins(env: Record<string, string | undefined> = process.env): string[] {
  return parseAllowedOrigins(env.ALLOWED_ORIGINS);
}

/**
 * The `experimental.serverActions` object, or `undefined` when nothing is configured — so
 * `next.config.ts` can omit the key rather than declare an empty allowlist. See above.
 */
export function serverActionsConfig(
  env: Record<string, string | undefined> = process.env
): { allowedOrigins: string[] } | undefined {
  const origins = allowedOrigins(env);
  return origins.length === 0 ? undefined : { allowedOrigins: origins };
}
