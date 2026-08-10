import { redirect } from "next/navigation";
import { connectJiraAccount } from "@/domain/jira-credentials";
import { jiraConfig } from "@/lib/jira-config";
import { exchangeCodeForRefreshToken } from "@/lib/jira-oauth";
import { logRequest } from "@/lib/logging";
import { verifyOAuthState } from "@/lib/oauth-state";
import { sessionSigningSecret } from "@/lib/session";
import { requireSession } from "@/ui/session";

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
  const auth = await requireSession();
  const url = new URL(request.url);

  const failure = (reason: string, detail: string): never => {
    logRequest({
      occurredAt: new Date().toISOString(),
      requestId: url.searchParams.get("state")?.slice(0, 8) ?? "jira-callback",
      status: 400,
      actorId: auth.userId,
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

  // The second check. A valid state issued to somebody else is not a licence to connect an
  // account to the person currently signed in.
  if (verified!.userId !== auth.userId) {
    failure("invalid", "Callback state was issued to a different user.");
  }

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

  await connectJiraAccount(refreshToken, {
    userId: auth.userId,
    role: auth.role,
    requestId: "jira-callback"
  });

  redirect("/account?jira=connected");
}
