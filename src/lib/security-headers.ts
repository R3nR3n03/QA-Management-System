/**
 * Security response headers (`PRODUCTION-READINESS-2026-07-31.md` A5).
 *
 * `next.config.ts` was `{ reactStrictMode: true }` and nothing else — no CSP, no HSTS, no
 * `X-Frame-Options`, no `X-Content-Type-Options`, no `Referrer-Policy`, no
 * `Permissions-Policy`. With a session cookie as the only credential and no server-side
 * revocation (A6, deferred), these headers are the difference between a contained XSS and
 * a session takeover.
 *
 * This module is PURE and imports nothing. That is load-bearing: `middleware.ts` runs on
 * the Edge runtime and imports `buildContentSecurityPolicy` from here, and anything that
 * reached `src/lib/session.ts` (Node `createHmac`/`timingSafeEqual`) or `src/lib/db.ts`
 * (constructs `PrismaPg` at module scope) would break middleware at load. Do not add an
 * import to this file without checking that.
 *
 * Split of responsibility: the static headers ship through `next.config.ts` `headers()`,
 * because they are the same for every request. Only the CSP goes through middleware,
 * because it carries a per-request nonce.
 *
 * These are not policy values — `docs/` specifies no response headers anywhere. They are
 * conventional hardening defaults and want QA Lead review like every other deployment
 * default in this change.
 */

export type SecurityHeaderContext = {
  /**
   * True only for a real production deployment. Two things hang off it: HSTS, and whether
   * the CSP tolerates `eval`.
   */
  isProduction: boolean;
};

export type ContentSecurityPolicyContext = SecurityHeaderContext & {
  /** Per-request, unguessable. Generated in `middleware.ts` via Web Crypto. */
  nonce: string;
};

/** Two years, the minimum any preload list accepts. */
const HSTS_MAX_AGE_SECONDS = 63072000;

/**
 * The headers that do not vary per request.
 *
 * `Strict-Transport-Security` is emitted ONLY in production, deliberately. HSTS is sticky
 * in the browser for its whole max-age: pinning `https` from a local `http://localhost:3000`
 * dev server poisons the developer's browser for two years for that origin, and there is no
 * way to serve it back. That is a foot-gun, not a hardening measure.
 *
 * `X-Frame-Options: DENY` duplicates the CSP's `frame-ancestors 'none'` on purpose — it is
 * the fallback for anything that does not honour the CSP, and the two agree.
 */
export function securityHeaders({ isProduction }: SecurityHeaderContext): Record<string, string> {
  const headers: Record<string, string> = {
    // No MIME sniffing: an uploaded workbook must never be interpreted as script.
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    // Send the origin cross-site, the full path same-site. Paths here carry record ids.
    "Referrer-Policy": "strict-origin-when-cross-origin",
    // QAMS needs none of these. Denying them costs nothing and shrinks the surface.
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()"
  };

  if (isProduction) {
    headers["Strict-Transport-Security"] = `max-age=${HSTS_MAX_AGE_SECONDS}; includeSubDomains`;
  }

  return headers;
}

/**
 * The Content-Security-Policy, with a per-request nonce.
 *
 * `script-src 'self' 'nonce-…' 'strict-dynamic'` is the point of the whole exercise: Next
 * emits inline bootstrap scripts, so a naive `'self'` policy breaks the app and an
 * `'unsafe-inline'` policy makes the header theatre. `'strict-dynamic'` lets the nonced
 * bootstrap load the chunks it needs without enumerating them.
 *
 * `'unsafe-eval'` is added ONLY outside production: Next's dev-mode HMR and React refresh
 * evaluate code at runtime. Production must never carry it — if a production build needs
 * `'unsafe-eval'`, something is wrong with the build, not with this policy.
 *
 * ## `style-src 'self' 'unsafe-inline'` — the one directive weaker than it should be
 *
 * The UI uses React inline `style={{ … }}` in 52 places (`src/app/login/page.tsx`,
 * `src/app/(app)/**`). React renders those as `style="…"` ATTRIBUTES, and a nonce cannot
 * cover an attribute — only a `<style>` element. Without `'unsafe-inline'` every one of
 * them is dropped and the UI renders unstyled.
 *
 * State the cost plainly: this leaves CSS-based exfiltration and UI-redress techniques
 * open. It does NOT weaken `script-src`, which is where the session-stealing risk lives.
 *
 * FOLLOW-UP (not this change): move those 52 inline styles into `src/app/globals.css` as
 * classes, then delete `'unsafe-inline'` from this line. It is mechanical, it touches every
 * UI file, and doing it here would bury four security fixes under a UI refactor.
 */
export function buildContentSecurityPolicy({
  nonce,
  isProduction
}: ContentSecurityPolicyContext): string {
  const scriptSrc = ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"];
  if (!isProduction) scriptSrc.push("'unsafe-eval'");

  const directives: string[][] = [
    ["default-src", "'self'"],
    ["script-src", ...scriptSrc],
    // See the note above. Required by the inline styles, and the weakest line here.
    ["style-src", "'self'", "'unsafe-inline'"],
    // data: covers inline SVG/data-URI icons. No remote image host is used.
    ["img-src", "'self'", "data:"],
    ["font-src", "'self'"],
    // Same-origin only: server actions and /api/v1 both post to this origin.
    ["connect-src", "'self'"],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    // Stops an injected form from posting credentials off-origin.
    ["form-action", "'self'"],
    ["frame-ancestors", "'none'"]
  ];

  return directives.map((parts) => parts.join(" ")).join("; ");
}
