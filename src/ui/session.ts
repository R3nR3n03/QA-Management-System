import { redirect } from "next/navigation";
import { requireAuth, type AuthContext } from "@/lib/auth";
import { AppError } from "@/lib/errors";

/**
 * The session gate for screens.
 *
 * `requireAuth` throws `AppError(403, UNAUTHORIZED)`, which is exactly right for an
 * API route — `withRoute` turns it into a JSON 403. A screen needs the opposite:
 * an unauthenticated visitor should be sent to sign in, not shown an error.
 *
 * WHY EVERY PAGE MUST CALL THIS, not just the layout: Next.js renders a layout and
 * its page CONCURRENTLY. A `redirect()` in the layout does not prevent the page's
 * own body from running, so a page that calls `requireAuth` directly throws before
 * the layout's redirect lands. Relying on the layout alone produced exactly that
 * error. The layout still calls this for its own data; the guarantee comes from the
 * page.
 *
 * This changes no policy: `requireAuth` remains the single check, and it still
 * resolves the role server-side from the session cookie
 * (`docs/api-and-security.md:37`). Only the failure presentation differs.
 */
export async function requireSession(): Promise<AuthContext> {
  let authenticated: AuthContext;
  try {
    authenticated = await requireAuth();
  } catch (error) {
    // ONLY an authentication failure means "go and sign in". `requireAuth` also issues
    // a `prisma.user.findUnique`, so a connection failure or timeout throws here too —
    // and a bare `catch` turned that into a redirect, so a database incident logged
    // every signed-in user out. They would then sign in, `authenticate()` would fail
    // the same way, and they would be told their credentials were the problem. Anything
    // that is not UNAUTHORIZED belongs to `src/app/error.tsx`, which reports it with a
    // log-correlatable reference instead of guessing.
    if (error instanceof AppError && error.code === "UNAUTHORIZED") {
      // Must be outside the try: redirect() signals by throwing, so calling it inside
      // would be swallowed by this very catch.
      redirect("/login");
    }
    throw error;
  }
  return authenticated;
}
