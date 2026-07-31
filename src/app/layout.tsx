import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "QAMS",
  description: "Quality Assurance Management System"
};

/**
 * Required by the Content-Security-Policy, not a performance choice
 * (`PRODUCTION-READINESS-2026-07-31.md` A5).
 *
 * `src/middleware.ts` mints a fresh nonce per request and Next stamps it onto its own
 * bootstrap `<script>` tags — but only when the page is rendered per request. A
 * STATICALLY PRERENDERED page is HTML produced at build time, when no request nonce
 * exists, so it is served with no nonce at all while the response still carries a CSP
 * demanding one. Because `script-src` uses `'strict-dynamic'`, the `'self'` source is
 * ignored by the browser, and every one of Next's script tags on that page is blocked.
 *
 * Verified, not theorised: with `/login` prerendered, the served HTML contained zero
 * `nonce` attributes against a header requiring one. The sign-in form would never
 * hydrate, which locks every user out of the entire application.
 *
 * Forcing dynamic rendering at the root is one line and covers every page, including any
 * added later — the alternative, a per-page opt-in, is silent whack-a-mole where the
 * failure mode is a blank screen. The cost is genuinely small here: only `/`, `/login`
 * and `/_not-found` were static, `/` is a bare redirect, and every other route is already
 * dynamic because it reads the session cookie. Nothing in this application is cacheable
 * anonymous content.
 */
export const dynamic = "force-dynamic";

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
