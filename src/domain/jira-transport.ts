import { JiraSyncOutcome } from "@prisma/client";
import { prisma } from "@/lib/db";
import { jiraConfig } from "@/lib/jira-config";
import { pickDoneTransition, type JiraTransition } from "@/lib/jira-transitions";
import { decryptSecret, encryptSecret, parseEncryptionKey } from "@/lib/secret-box";
import type {
  JiraTransitionRequest,
  JiraTransitionResult,
  JiraTransport
} from "@/domain/jira-sync";

/**
 * The half of the sync that actually talks to Jira.
 *
 * Everything above this file is deterministic — `shouldTransitionIssue` decides WHETHER, and
 * `pickDoneTransition` decides WHICH. This decides nothing; it performs.
 *
 * ## Rotating refresh tokens
 *
 * Atlassian issues rotating refresh tokens: a refresh token is SINGLE USE, and spending it
 * returns a new one that replaces it. Two consequences drive the design here.
 *
 * First, the new token must be persisted immediately, in the same await as the exchange. Miss
 * that and the stored token is dead the moment it is first used — every later sync for that
 * person fails, looking exactly like "their token expired", which is the failure mode hardest
 * to diagnose from the outside.
 *
 * Second, Atlassian detects REUSE: replaying a spent token can invalidate the whole token
 * family, disconnecting the person entirely. So one credential must never be refreshed
 * concurrently. The row is locked for the duration of the exchange, which serialises retries
 * for the same user across the process — see `withRefreshedAccessToken`.
 *
 * ## Never throws for an ordinary failure
 *
 * `transitionToDone` resolves with `FAILED` and a reason rather than throwing, because a
 * failed sync is a normal, recordable outcome — the caller writes it to `JiraSyncAttempt` for
 * a QA Lead. Only a programming error escapes as a throw, and `settleJiraSync` catches that.
 */

/**
 * Ceiling on the token exchange specifically, kept under the surrounding transaction's
 * timeout so a slow Atlassian can never strand a spent refresh token.
 */
const REFRESH_TIMEOUT_MS = 8_000;

const ATLASSIAN_TOKEN_URL = "https://auth.atlassian.com/oauth/token";
const ATLASSIAN_RESOURCES_URL = "https://api.atlassian.com/oauth/token/accessible-resources";

/** Injected so tests and a stub Jira can stand in for the network. */
export type FetchLike = typeof fetch;

function failed(reason: string, actorId: string | null = null): JiraTransitionResult {
  return { outcome: JiraSyncOutcome.FAILED, failureReason: reason, actorId };
}

/**
 * Spends a user's refresh token for an access token, stores the replacement, and returns the
 * access token.
 *
 * The stored row is locked `FOR UPDATE` for the whole exchange. Without it, two retries for
 * one person could spend the same refresh token concurrently, which Atlassian treats as reuse
 * and answers by revoking the family — turning a transient double-retry into that person
 * being silently disconnected.
 */
async function withRefreshedAccessToken(
  userId: string,
  doFetch: FetchLike
): Promise<{ accessToken: string } | { error: string }> {
  const config = jiraConfig();
  if (!config.enabled || !config.clientId || !config.clientSecret || !config.encryptionKey) {
    return { error: "Jira is not configured." };
  }
  const key = parseEncryptionKey(config.encryptionKey);

  return prisma.$transaction(async (tx) => {
    // Serialises refreshes for this one credential; other users are unaffected.
    const locked = await tx.$queryRaw<Array<{ encryptedRefreshToken: string }>>`
      SELECT "encryptedRefreshToken" FROM "JiraCredential" WHERE "userId" = ${userId} FOR UPDATE
    `;
    if (locked.length === 0) return { error: "No Jira account is connected for this user." };

    let refreshToken: string;
    try {
      refreshToken = decryptSecret(locked[0].encryptedRefreshToken, key);
    } catch {
      // A key rotation, or a tampered row. Either way the credential is unusable and the
      // person has to reconnect; saying so plainly beats a confusing 401 from Atlassian.
      return { error: "The stored Jira credential could not be decrypted. Reconnect the account." };
    }

    const response = await doFetch(ATLASSIAN_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Bounded well inside the transaction timeout below. Unbounded, a slow Atlassian would
      // let the transaction expire AFTER the refresh token had already been spent and
      // rotated — the rollback would discard the replacement and leave the stored token
      // permanently dead, with the account still showing as connected.
      signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
      body: JSON.stringify({
        grant_type: "refresh_token",
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: refreshToken
      })
    });

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { error: `Jira returned a non-JSON refresh response (HTTP ${response.status}).` };
    }

    const record = (body ?? {}) as Record<string, unknown>;
    if (typeof record.error === "string") {
      return { error: `Jira refused the refresh (${record.error}).` };
    }
    if (typeof record.access_token !== "string") {
      return { error: "Jira returned no access token." };
    }

    // The rotated token, persisted before the access token is used for anything. If Atlassian
    // did not rotate, the value is simply rewritten unchanged.
    if (typeof record.refresh_token === "string" && record.refresh_token !== "") {
      await tx.jiraCredential.update({
        where: { userId },
        data: { encryptedRefreshToken: encryptSecret(record.refresh_token, key) }
      });
    }

    return { accessToken: record.access_token };
  },
  {
    /**
     * Deliberately longer than `REFRESH_TIMEOUT_MS`, and deliberately not the 5s default.
     *
     * Spending a rotating refresh token is not idempotent: once Atlassian answers, the old
     * token is dead whether or not we manage to store the replacement. So the transaction
     * must not be able to expire while that exchange is outstanding — the fetch is bounded
     * first, and this leaves room for it to settle and the write to land.
     *
     * The honest cost: a pool connection and a row lock are held across third-party network
     * I/O, which `settleJiraSync` otherwise refuses. It is accepted HERE and nowhere else,
     * because Atlassian revokes an entire token family on detecting reuse, so two concurrent
     * refreshes of one credential would disconnect the person outright. Bounded I/O under a
     * lock is the lesser harm than an unserialised refresh.
     */
    timeout: REFRESH_TIMEOUT_MS + 10_000,
    maxWait: 10_000
  });
}

/** Resolves the Jira site id this token can reach. */
async function resolveCloudId(
  accessToken: string,
  baseUrl: string,
  doFetch: FetchLike,
  timeoutMs: number
): Promise<string | null> {
  const response = await doFetch(ATLASSIAN_RESOURCES_URL, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) return null;

  const sites = (await response.json()) as Array<{ id?: string; url?: string }>;
  if (!Array.isArray(sites) || sites.length === 0) return null;

  // Match the configured site rather than taking the first: an account-level grant can reach
  // several sites, and transitioning an issue on the wrong one would be silent and wrong.
  const wanted = baseUrl.replace(/\/+$/, "").toLowerCase();
  const match = sites.find((site) => (site.url ?? "").replace(/\/+$/, "").toLowerCase() === wanted);

  // No fallback to the first reachable site. The grant is account-level and can reach a
  // sandbox or another team's Jira; transitioning PROJ-123 on the wrong instance would
  // succeed, look fine, and be wrong. No match is a failure with a reason, not a guess.
  return match?.id ?? null;
}

/**
 * The transport installed at startup.
 *
 * `doFetch` is a parameter so a stub Jira can be supplied in place of the network — the
 * verification strategy agreed for this feature, since a real handshake needs credentials
 * this environment does not have.
 */
export function createJiraTransport(doFetch: FetchLike = fetch): JiraTransport {
  return {
    async transitionToDone(request: JiraTransitionRequest): Promise<JiraTransitionResult> {
      const config = jiraConfig();
      if (!config.enabled || !config.baseUrl) return failed("Jira is not configured.");

      // Per-user first, as chosen: a transition should read as the person whose run caused it.
      // The service account is a fallback for a credential that cannot be used, and exists
      // only where one is configured.
      const refreshed = await withRefreshedAccessToken(request.actorId, doFetch);
      if ("error" in refreshed) {
        if (!config.serviceAccountFallback) {
          return failed(`${refreshed.error} No service account is configured to fall back to.`);
        }
        // The service-account path needs an email to pair with the token for Atlassian Basic
        // auth, which the configuration does not carry yet. Reported rather than guessed.
        return failed(
          `${refreshed.error} The service-account fallback is enabled but not implemented: it needs JIRA_SERVICE_ACCOUNT_EMAIL alongside the token.`
        );
      }

      const cloudId = await resolveCloudId(refreshed.accessToken, config.baseUrl, doFetch, request.timeoutMs);
      if (!cloudId) return failed("Could not resolve the Jira site for this account.", request.actorId);

      const api = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${encodeURIComponent(request.issueKey)}/transitions`;
      const auth = { Authorization: `Bearer ${refreshed.accessToken}`, Accept: "application/json" };

      const available = await doFetch(api, { headers: auth, signal: AbortSignal.timeout(request.timeoutMs) });
      if (available.status === 404) {
        return failed(`Jira issue ${request.issueKey} was not found, or is not visible to this account.`, request.actorId);
      }
      if (!available.ok) {
        return failed(`Jira refused to list transitions (HTTP ${available.status}).`, request.actorId);
      }

      const payload = (await available.json()) as { transitions?: JiraTransition[] };
      const projectKey = request.issueKey.split("-")[0];
      const transitionId = pickDoneTransition(
        payload.transitions ?? [],
        config.transitionOverrides.get(projectKey) ?? null
      );

      if (!transitionId) {
        return failed(
          `No transition to a done status is available for ${request.issueKey} from its current status.`,
          request.actorId
        );
      }

      const applied = await doFetch(api, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(request.timeoutMs),
        body: JSON.stringify({ transition: { id: transitionId } })
      });

      // Jira answers a successful transition with 204 and no body.
      if (applied.status !== 204 && !applied.ok) {
        return failed(`Jira refused the transition (HTTP ${applied.status}).`, request.actorId);
      }

      return { outcome: JiraSyncOutcome.SUCCEEDED, actorId: request.actorId };
    }
  };
}
