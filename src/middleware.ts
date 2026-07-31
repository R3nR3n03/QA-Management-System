import { NextResponse, type NextRequest } from "next/server";
import { buildContentSecurityPolicy } from "@/lib/security-headers";

/**
 * Content-Security-Policy, and nothing else (`PRODUCTION-READINESS-2026-07-31.md` A5).
 *
 * ## Why this file is `src/middleware.ts` and not `middleware.ts`
 *
 * Next looks for middleware beside the routing directory, not at the repository root.
 * This project keeps its app in `src/app`, so the file must sit in `src/`. At the root it
 * is silently ignored — no error, no warning, an empty `middleware-manifest.json`, and a
 * response with no CSP on it. Verified: the root placement built cleanly and registered
 * nothing.
 *
 * ## Import discipline — the constraint that governs this file
 *
 * This runs on the **Edge runtime**. It may import ONLY `next/server` and
 * `@/lib/security-headers`, which is pure and imports nothing itself.
 *
 * Anything reaching `src/lib/session.ts` (Node `createHmac` / `timingSafeEqual`) or
 * `src/lib/db.ts` (constructs `PrismaPg` at module scope, at import time) breaks this file
 * at load — not at first use — and takes every route down with it. Do not add an import
 * here without following it all the way down. In particular this file does NOT read the
 * session cookie and does NOT authenticate: `requireAuth()` inside `withRoute()` is where
 * that belongs, and `docs/` requires the role to be resolved server-side per request from
 * the database, which is not reachable from here.
 *
 * ## Why the CSP is here and the other headers are not
 *
 * The static headers are identical for every request and ship through `next.config.ts`
 * `headers()`, which is cheaper and needs no middleware invocation. Only the CSP needs a
 * fresh per-request nonce, which is the whole reason middleware exists in this project.
 *
 * ## Why the nonce is set on the REQUEST headers too
 *
 * Next reads `Content-Security-Policy` off the incoming request headers to discover the
 * nonce and stamp it onto its own bootstrap `<script>` tags. Setting it only on the
 * response means the browser enforces a policy that Next's own scripts do not satisfy, and
 * the app renders blank. Both are required, and they must carry the same value.
 *
 * ## Rate limiting is deliberately NOT here
 *
 * See `src/lib/rate-limit.ts`. There are two entry points to the same credential check
 * (`POST /api/v1/auth/login` and the `signIn` server action) and identifying a server-action
 * POST from middleware means sniffing the `Next-Action` header, which is fragile and
 * undocumented. Explicit call sites cover both and stay unit-testable.
 */
export function middleware(request: NextRequest): NextResponse {
  // Web Crypto, available on Edge. Do NOT reach for node:crypto here.
  const nonce = crypto.randomUUID();
  const csp = buildContentSecurityPolicy({
    nonce,
    isProduction: process.env.NODE_ENV === "production"
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("Content-Security-Policy", csp);
  // Exposed separately so a server component can read it via `headers()` if it ever needs
  // to nonce a script of its own.
  requestHeaders.set("x-nonce", nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  /**
   * Everything except statically served assets. `_next/static` and `_next/image` are
   * immutable build output and `favicon.ico` is a file — none of them can execute script,
   * so a CSP on them costs a middleware invocation and buys nothing.
   */
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
