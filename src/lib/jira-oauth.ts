/**
 * The Jira OAuth handshake — building the consent URL and reading the token response.
 *
 * Split out from the route handlers and kept pure so the parts that can be wrong are
 * testable without a network. `exchangeCodeForRefreshToken` is the one function that
 * actually talks to Atlassian, and it takes its `fetch` as an argument so a stub can stand
 * in for Jira (Q8) — every other decision here is a string or a shape check.
 *
 * ## The seam a stub cannot prove
 *
 * Whether Atlassian's real token body matches `parseTokenResponse`. That is the single
 * unverified thing in this feature, which is exactly why that function refuses anything it
 * does not recognise instead of coercing: an empty or missing refresh token must fail loudly
 * at connect time, not get encrypted, stored, and discovered weeks later when a retry needs
 * it.
 */

/**
 * Holds the signed OAuth state for the length of the consent round trip.
 *
 * Separate from the session cookie because the two need different SameSite scopes: the
 * session is `Strict` and is therefore absent on the callback, while this one is `Lax` so it
 * arrives on exactly that top-level navigation and nothing else.
 */
export const JIRA_CONNECT_COOKIE = "qams_jira_connect";

/** Atlassian's 3LO endpoints. Fixed, and not per-site — the Jira site is chosen by consent. */
const AUTHORIZE_ENDPOINT = "https://auth.atlassian.com/authorize";
const TOKEN_ENDPOINT = "https://auth.atlassian.com/oauth/token";

/**
 * `offline_access` is what yields a refresh token: without it the grant dies in about an
 * hour, and the retry queue could never replay as that person — which is the whole premise
 * of per-user attribution. `write:jira-work` is what permits a transition.
 */
const SCOPES = ["offline_access", "read:jira-work", "write:jira-work"];

/** Where to send someone to approve the connection. */
export function authorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const url = new URL(AUTHORIZE_ENDPOINT);
  url.searchParams.set("audience", "api.atlassian.com");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  // Atlassian returns a refresh token only when consent is explicitly requested.
  url.searchParams.set("prompt", "consent");
  return url.toString();
}

/**
 * Pulls the refresh token out of a token response, or throws.
 *
 * Every failure is a throw rather than a null, because there is nothing sensible for a
 * caller to do with "connected, but no usable credential" — that state would look connected
 * on screen and fail silently at every sync.
 */
export function parseTokenResponse(body: unknown): string {
  if (body === null || typeof body !== "object") {
    throw new Error("Jira returned an unreadable token response.");
  }

  const record = body as Record<string, unknown>;

  // An OAuth error body is well-formed JSON with no token in it. Reporting "no refresh
  // token" for one would hide the actual reason, which is the thing a person needs.
  if (typeof record.error === "string") {
    const detail = typeof record.error_description === "string" ? `: ${record.error_description}` : "";
    throw new Error(`Jira refused the authorization (${record.error}${detail}).`);
  }

  const refreshToken = record.refresh_token;
  if (typeof refreshToken !== "string" || refreshToken.trim() === "") {
    throw new Error(
      "Jira returned no refresh token. The OAuth app must request the offline_access scope."
    );
  }

  return refreshToken;
}

/** Injected so a stub can stand in for Atlassian without a network. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Trades the authorization code for a refresh token.
 *
 * The client secret is sent in the POST body over TLS to Atlassian and never leaves this
 * function; nothing here logs it, and the caller only ever sees the refresh token.
 */
export async function exchangeCodeForRefreshToken(
  params: {
    code: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  },
  doFetch: FetchLike = fetch
): Promise<string> {
  const response = await doFetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: params.clientId,
      client_secret: params.clientSecret,
      code: params.code,
      redirect_uri: params.redirectUri
    })
  });

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(`Jira returned a non-JSON token response (HTTP ${response.status}).`);
  }

  // Parsed before the status is consulted, because an error body carries the useful reason
  // and a bare status code does not.
  return parseTokenResponse(body);
}
