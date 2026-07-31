import { redirect } from "next/navigation";
import { requireAuth, type AuthContext } from "@/lib/auth";

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
  try {
    return await requireAuth();
  } catch {
    // Must be outside the try: redirect() signals by throwing, so calling it inside
    // would be swallowed by this very catch.
    redirect("/login");
  }
}
