import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { jiraConfig } from "@/lib/jira-config";
import { JIRA_CONNECT_COOKIE } from "@/lib/jira-oauth";
import { authorizeUrl } from "@/lib/jira-oauth";
import { createOAuthState, OAUTH_STATE_TTL_MS } from "@/lib/oauth-state";
import { sessionCookieOptions, sessionSigningSecret } from "@/lib/session";
import { requireSession } from "@/ui/session";

/**
 * Start the Jira connect flow: sign a `state`, then hand the browser to Atlassian.
 *
 * A GET that redirects rather than the usual `withRoute` JSON handler, because the caller is
 * a browser following a link, not an API client — a JSON error body would render as text in
 * the address bar. Failures go back to `/account` with a reason in the query string, where
 * the panel that started the flow can explain them.
 *
 * The `state` is the whole security of this step. Without it, anyone who can make a signed-in
 * victim's browser reach the callback binds THEIR Jira account to the victim's QAMS user, and
 * every transition the victim later causes is written to Jira as the attacker
 * (`src/lib/oauth-state.ts`).
 */
export async function GET() {
  // Throws to /login when there is no session, so an unauthenticated caller can never mint a
  // state — the state names a user, and there must be one.
  const auth = await requireSession();

  const config = jiraConfig();
  if (!config.enabled || !config.clientId || !config.redirectUri) {
    redirect("/account?jira=unconfigured");
  }

  const state = createOAuthState(auth.userId, sessionSigningSecret());

  /**
   * The state is also parked in its own cookie, and this is load-bearing.
   *
   * The session cookie is `SameSite=Strict` (`sessionCookieOptions`), which browsers withhold
   * on every cross-site request INCLUDING top-level navigation — so the callback arriving from
   * auth.atlassian.com carries no session at all, and `requireSession()` there would bounce the
   * user to /login with the authorization thrown away. That is not a bug in the Strict setting;
   * it is what Strict is for, and loosening it app-wide to rescue one feature would trade a
   * deliberate CSRF defence for convenience.
   *
   * `Lax` is the correct scope for THIS cookie: it is sent on exactly one kind of cross-site
   * request — a top-level GET navigation — which is precisely the callback and nothing else.
   * It lives for the length of the consent round trip and carries no authority of its own; it
   * proves only that the browser completing the flow is the browser that began it.
   */
  (await cookies()).set(JIRA_CONNECT_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: sessionCookieOptions().secure,
    path: "/api/v1/jira",
    maxAge: Math.floor(OAUTH_STATE_TTL_MS / 1000)
  });

  redirect(authorizeUrl(config.clientId, config.redirectUri, state));
}
