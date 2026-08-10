import { redirect } from "next/navigation";
import { jiraConfig } from "@/lib/jira-config";
import { authorizeUrl } from "@/lib/jira-oauth";
import { createOAuthState } from "@/lib/oauth-state";
import { sessionSigningSecret } from "@/lib/session";
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
  redirect(authorizeUrl(config.clientId, config.redirectUri, state));
}
