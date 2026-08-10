import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connectJiraAccount } from "@/domain/jira-credentials";
import { prisma } from "@/lib/db";
import { jiraConfig } from "@/lib/jira-config";
import { exchangeCodeForRefreshToken, JIRA_CONNECT_COOKIE } from "@/lib/jira-oauth";
import { logRequest } from "@/lib/logging";
import { verifyOAuthState } from "@/lib/oauth-state";
import { sessionSigningSecret } from "@/lib/session";

/**
 * Where Atlassian sends the user back after consent.
 *
 * Redirects rather than returning JSON, for the same reason as the connect route: the caller
 * is a browser. Every outcome lands on `/account` with a short reason in the query string,
 * and the connection panel turns that into a sentence.
 *
 * ## The two identity checks, and why both are needed
 *
 * The `state` must verify AND the user it names must be the user whose session is presenting
 * it. The signature alone proves QAMS issued the state; it does not prove the browser
 * carrying it belongs to that person. Without the second check, a state captured from one
 * user could be replayed by another to bind a Jira account to someone else's QAMS user.
 *
 * ## Why nothing is recorded on failure
 *
 * A failed handshake stores no credential and writes no audit event about a user, because
 * until `state` verifies there is no trustworthy claim about WHICH user this concerns. The
 * failure is logged server-side instead.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const jar = await cookies();

  /**
   * Identity comes from the signed state and the connect cookie, NOT from the session.
   *
   * The session cookie is `SameSite=Strict` and is therefore not sent on this request at all
   * — it arrives as a top-level navigation from auth.atlassian.com. Calling `requireSession()`
   * here would redirect every successful authorization to /login and silently discard it,
   * which is exactly the bug this replaces.
   *
   * The two checks that remain are the two that matter: the state must carry a valid QAMS
   * signature and be unexpired, and the same value must come back in the cookie set when the
   * flow began. The first proves QAMS issued it; the second proves this is the browser it was
   * issued to. An attacker needs both, and the cookie is httpOnly.
   */
  const cookieState = jar.get(JIRA_CONNECT_COOKIE)?.value;

  const failure = (reason: string, detail: string): never => {
    // The cookie is cleared on every exit so a spent or rejected state cannot be replayed.
    // The path must match the one the cookie was set with, or the deletion silently misses
    // and the spent state stays replayable for its whole ten-minute lifetime.
    jar.delete({ name: JIRA_CONNECT_COOKIE, path: "/api/v1/jira" });
    logRequest({
      occurredAt: new Date().toISOString(),
      requestId: url.searchParams.get("state")?.slice(0, 8) ?? "jira-callback",
      status: 400,
      action: "JIRA_CONNECT_FAILED",
      message: detail
    });
    redirect(`/account?jira=${reason}`);
  };

  // Atlassian reports a refusal on the redirect itself — the user pressed Cancel, or the app
  // is misconfigured. There is no code to exchange in that case.
  const oauthError = url.searchParams.get("error");
  if (oauthError) failure("denied", `Jira refused the authorization: ${oauthError}`);

  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!state || !code) failure("invalid", "Callback arrived without a state or code.");

  const verified = verifyOAuthState(state as string, sessionSigningSecret());
  if (!verified) failure("invalid", "Callback state was forged, tampered with, or expired.");

  // The second check: the browser finishing the flow must be the one that started it. A valid
  // state on its own is not enough — it travels in a URL, and URLs leak.
  if (!cookieState || cookieState !== state) {
    failure("invalid", "Callback state did not match the cookie set when the flow began.");
  }

  const userId = verified!.userId;

  const config = jiraConfig();
  if (!config.enabled || !config.clientId || !config.clientSecret || !config.redirectUri) {
    failure("unconfigured", "Jira is not configured for this deployment.");
  }

  let refreshToken: string;
  try {
    refreshToken = await exchangeCodeForRefreshToken({
      code: code as string,
      clientId: config.clientId as string,
      clientSecret: config.clientSecret as string,
      redirectUri: config.redirectUri as string
    });
  } catch (error) {
    // The message may quote Atlassian's error body, so it is logged server-side and never
    // put in the redirect a browser can read.
    failure("exchange", error instanceof Error ? error.message : "Token exchange failed.");
    return;
  }

  // The role is read from the database rather than a session, for the same reason the whole
  // codebase resolves it server-side: it is never taken from the caller. `connectJiraAccount`
  // stores against this id and audits it.
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, active: true } });
  if (!user || !user.active) failure("invalid", "The state named a user who cannot connect.");

  await connectJiraAccount(refreshToken, {
    userId,
    role: user!.role,
    requestId: "jira-callback"
  });

  // Spent: one authorization, one connection.
  jar.delete(JIRA_CONNECT_COOKIE);
  redirect("/account?jira=connected");
}
