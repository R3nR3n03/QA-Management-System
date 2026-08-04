import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export const metadata: Metadata = {
  title: "QAMS",
  description: "Quality Assurance Management System"
};

/**
 * The stored theme, applied before first paint.
 *
 * The theme used to be applied by an effect inside `Sidebar`, which only `(app)`
 * renders — so a user who explicitly chose dark still got a LIGHT sign-in screen, a
 * light 404 and a light error page: the three screens most likely to open a session.
 * Running it at the root covers every route.
 *
 * Inline and synchronous because it has to win the race against first paint; an effect
 * cannot, which is why the old approach also flashed light before repainting. It reads
 * the same `qams-theme` key the sidebar toggle writes, and stays silent if the value is
 * absent or unreadable (Safari private mode throws on `localStorage`), leaving the
 * `prefers-color-scheme` media query to decide — which is exactly what "system" means.
 */
const THEME_BOOTSTRAP = `try{var t=localStorage.getItem("qams-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

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

export default async function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  // `script-src` is `'self' 'nonce-…' 'strict-dynamic'`, so an un-nonced inline script
  // is blocked outright. `src/middleware.ts` exposes the per-request nonce on `x-nonce`
  // for exactly this.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
         * `suppressHydrationWarning` is about the NONCE, not the script body.
         *
         * The HTML spec hides nonces: the moment an element is inserted into a document
         * carrying a header-delivered CSP — which `src/middleware.ts` always sets — the
         * browser blanks the `nonce` content attribute and keeps the real value only on
         * the `.nonce` IDL property. That is deliberate, and it stops an attacker from
         * exfiltrating the nonce with a CSS attribute selector.
         *
         * React hydrates by reading attributes, so it sees `nonce="<uuid>"` in the server
         * HTML and `nonce=""` in the DOM and reports a mismatch it then declines to patch.
         * Nothing is actually wrong: this script ran to completion before React loaded,
         * and the CSP was satisfied at parse time by the nonce the browser has since
         * hidden. The warning is unavoidable and purely cosmetic; suppressing it here
         * keeps it from masking real hydration bugs elsewhere.
         *
         * Scoped to this one element — `suppressHydrationWarning` only covers an element's
         * own attributes and text, so the `<html>` tag above does not already cover it, and
         * this does not silence anything in `children`.
         */}
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
