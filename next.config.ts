import type { NextConfig } from "next";
import { serverActionsConfig } from "./src/lib/allowed-origins";
import { securityHeaders } from "./src/lib/security-headers";
import { maxUploadBytes } from "./src/lib/upload-limits";

/**
 * `PRODUCTION-READINESS-2026-07-31.md` A5 (security headers), A7 (CSRF) and D1 (deployment).
 *
 * The static security headers ship from here rather than from `middleware.ts` because they
 * are identical for every request. Only the Content-Security-Policy is set in middleware,
 * because it carries a per-request nonce — see `middleware.ts` and
 * `src/lib/security-headers.ts`. Do not add a CSP here: a static one would either have no
 * nonce (and break Next's inline bootstrap scripts) or a fixed one (which is not a nonce).
 *
 * Both imports are of PURE modules with no dependencies of their own. This file is
 * evaluated by Next's config loader outside the app bundle, so it must not pull in
 * anything that touches Prisma, `next/headers`, or Node-only session crypto.
 */

const isProduction = process.env.NODE_ENV === "production";

/**
 * A7. Omitted entirely when `ALLOWED_ORIGINS` is unset, so Next keeps its own default
 * same-origin check rather than being handed an empty allowlist — see
 * `src/lib/allowed-origins.ts` for why those are not the same thing, and for an honest
 * statement of how little this is worth without a deployed hostname.
 */
const serverActions = serverActionsConfig();

const nextConfig: NextConfig = {
  reactStrictMode: true,

  /**
   * D1. Emits `.next/standalone/server.js` with only the traced runtime dependencies, so a
   * deployment is a directory copy plus `node server.js` rather than a full `node_modules`.
   * This is the one part of D1 that is genuinely verified here, because `npm run build` is
   * a required gate. The CI workflow in `.github/workflows/ci.yml` has never executed —
   * there is no git remote to run it.
   */
  output: "standalone",

  /**
   * Next caps server-action request bodies at 1 MB by default, which silently broke the
   * workbook-upload screen for any real .xlsx over that size while the API route allowed
   * 10 MB. Sized from the same `MAX_UPLOAD_BYTES` the route enforces, plus 1 MB of
   * multipart overhead — the route-level checks in `src/lib/upload-limits.ts` remain the
   * precise gate; this is just the transport ceiling above it. `upload-limits` is a pure
   * module, so it is safe in the config loader.
   */
  experimental: {
    serverActions: {
      ...(serverActions ?? {}),
      bodySizeLimit: maxUploadBytes() + 1024 * 1024
    }
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: Object.entries(securityHeaders({ isProduction })).map(([key, value]) => ({
          key,
          value
        }))
      }
    ];
  }
};

export default nextConfig;
