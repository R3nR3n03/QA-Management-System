import { JiraCommentOutcome, JiraSyncOutcome } from "@prisma/client";
import { prisma } from "@/lib/db";
import { jiraConfig } from "@/lib/jira-config";
import { pickDoneTransition, type JiraTransition } from "@/lib/jira-transitions";
import { decryptSecret, encryptSecret, parseEncryptionKey } from "@/lib/secret-box";
import type {
  JiraCommentRequest,
  JiraCommentResult,
  JiraCreateIssueRequest,
  JiraCreateIssueResult,
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

function commentFailed(reason: string, actorId: string | null = null): JiraCommentResult {
  return { outcome: JiraCommentOutcome.FAILED, failureReason: reason, actorId };
}

function createFailed(reason: string, actorId: string | null = null): JiraCreateIssueResult {
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
 * Everything a call to Jira needs before it can be made: a usable access token and the id of
 * the site the configured base URL names.
 *
 * Shared by both writes because both need exactly this and both must report the same reasons
 * for not getting it. `actorId` on the failure says whose credential was established before
 * the step that failed — null when no credential could be used at all, which is how a reader
 * tells "this person is not connected" from "we could not reach their site".
 */
type JiraApiContext = { accessToken: string; cloudId: string };
type JiraApiFailure = { error: string; actorId: string | null };

async function resolveApiContext(
  actorId: string,
  timeoutMs: number,
  doFetch: FetchLike
): Promise<JiraApiContext | JiraApiFailure> {
  const config = jiraConfig();
  if (!config.enabled || !config.baseUrl) return { error: "Jira is not configured.", actorId: null };

  // Per-user first, as chosen: a write should read as the person whose run caused it. The
  // service account is a fallback for a credential that cannot be used, and exists only where
  // one is configured.
  const refreshed = await withRefreshedAccessToken(actorId, doFetch);
  if ("error" in refreshed) {
    if (!config.serviceAccountFallback) {
      return { error: `${refreshed.error} No service account is configured to fall back to.`, actorId: null };
    }
    // The service-account path needs an email to pair with the token for Atlassian Basic
    // auth, which the configuration does not carry yet. Reported rather than guessed.
    return {
      error: `${refreshed.error} The service-account fallback is enabled but not implemented: it needs JIRA_SERVICE_ACCOUNT_EMAIL alongside the token.`,
      actorId: null
    };
  }

  const cloudId = await resolveCloudId(refreshed.accessToken, config.baseUrl, doFetch, timeoutMs);
  if (!cloudId) return { error: "Could not resolve the Jira site for this account.", actorId };

  return { accessToken: refreshed.accessToken, cloudId };
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
      const context = await resolveApiContext(request.actorId, request.timeoutMs, doFetch);
      if ("error" in context) return failed(context.error, context.actorId);

      const api = `https://api.atlassian.com/ex/jira/${context.cloudId}/rest/api/3/issue/${encodeURIComponent(request.issueKey)}/transitions`;
      const auth = { Authorization: `Bearer ${context.accessToken}`, Accept: "application/json" };

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
    },

    /**
     * Posts a result comment, on the **v2** API rather than the v3 one the transition uses.
     *
     * That is the one deliberate inconsistency in this file. Jira Cloud's v3 comment endpoint
     * takes ADF — a JSON document tree — while v2 takes a plain wiki-markup string, which is a
     * fraction of the code for the same rendered comment. The bill is paid in
     * `src/domain/jira-comment.ts`, which must escape every span a tester wrote before it
     * reaches this line (ADR-0004).
     */
    async postComment(request: JiraCommentRequest): Promise<JiraCommentResult> {
      const context = await resolveApiContext(request.actorId, request.timeoutMs, doFetch);
      if ("error" in context) return commentFailed(context.error, context.actorId);

      const api = `https://api.atlassian.com/ex/jira/${context.cloudId}/rest/api/2/issue/${encodeURIComponent(request.issueKey)}/comment`;

      const posted = await doFetch(api, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${context.accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json"
        },
        signal: AbortSignal.timeout(request.timeoutMs),
        body: JSON.stringify({ body: request.body })
      });

      if (posted.status === 404) {
        return commentFailed(
          `Jira issue ${request.issueKey} was not found, or is not visible to this account.`,
          request.actorId
        );
      }
      if (!posted.ok) {
        return commentFailed(`Jira refused the comment (HTTP ${posted.status}).`, request.actorId);
      }

      // The comment is already posted by this point, so an unreadable body is NOT a failure:
      // reporting one would record that QAMS did not comment on an issue it just commented on,
      // and nothing retries a comment, so the lie would stand forever. The id is lost, and the
      // id is the only thing lost.
      let commentId: string | null = null;
      try {
        const created = (await posted.json()) as { id?: unknown };
        if (typeof created.id === "string") commentId = created.id;
      } catch {
        commentId = null;
      }

      return { outcome: JiraCommentOutcome.SUCCEEDED, commentId, actorId: request.actorId };
    },

    /**
     * Raise the bug for a defect, or adopt the one an earlier attempt already raised.
     *
     * ## Why this looks before it creates
     *
     * Creating an issue is the only write in this file that is not idempotent. A create can
     * succeed in Jira and still fail to be recorded in QAMS — the response can be lost, the
     * process can be killed between Jira's answer and the write that stores the key — and the
     * retry worker would then raise a SECOND bug for the same defect. Duplicate bugs in a
     * shared project are tedious to clean up and impossible to clean up invisibly, so the
     * search is paid on every create rather than on the retries alone, which are exactly the
     * calls that cannot tell they are retries (ADR-0006).
     *
     * A failed search does NOT fall through to creating. That is the whole point: searching is
     * how this call knows whether it is about to duplicate something, so proceeding without an
     * answer would defeat it. It fails, and the retry tries the pair again.
     *
     * Uses the **v2** API, like `postComment` and for the same reason: v2 takes a plain
     * wiki-markup description string where v3 requires an ADF document tree.
     */
    async createIssue(request: JiraCreateIssueRequest): Promise<JiraCreateIssueResult> {
      const context = await resolveApiContext(request.actorId, request.timeoutMs, doFetch);
      if ("error" in context) return createFailed(context.error, context.actorId);

      const base = `https://api.atlassian.com/ex/jira/${context.cloudId}/rest/api/2`;
      const auth = {
        Authorization: `Bearer ${context.accessToken}`,
        Accept: "application/json"
      };

      // The label is the handle on our own work. `qamsDefectLabel` derives it from a business
      // ID that `BUSINESS_ID_PATTERNS` restricts to letters, digits and hyphens, so there is
      // nothing in one that could escape these quotes and alter the JQL.
      const label = request.labels[0];
      if (label !== undefined) {
        // `/search/jql`, not the bare `/search` this would have used a couple of years ago:
        // Jira Cloud removed the old GET endpoint in favour of this one, which takes the same
        // query and answers with the same `issues` array.
        const jql = `project = "${request.projectKey}" AND labels = "${label}"`;
        const search = await doFetch(
          `${base}/search/jql?jql=${encodeURIComponent(jql)}&maxResults=1&fields=key`,
          { headers: auth, signal: AbortSignal.timeout(request.timeoutMs) }
        );

        if (!search.ok) {
          return createFailed(
            `Jira refused the duplicate check before creating the issue (HTTP ${search.status}).`,
            request.actorId
          );
        }

        let existingKey: string | null = null;
        try {
          const found = (await search.json()) as { issues?: Array<{ key?: unknown }> };
          const first = found.issues?.[0]?.key;
          if (typeof first === "string") existingKey = first;
        } catch {
          // An unreadable search response is not "nothing found": treating it as such is
          // precisely how a duplicate gets raised. Refused, and retried later.
          return createFailed(
            "Jira returned an unreadable response to the duplicate check before creating the issue.",
            request.actorId
          );
        }

        if (existingKey !== null) {
          return {
            outcome: JiraSyncOutcome.SUCCEEDED,
            issueKey: existingKey,
            adopted: true,
            actorId: request.actorId
          };
        }
      }

      const created = await doFetch(`${base}/issue`, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(request.timeoutMs),
        body: JSON.stringify({
          fields: {
            project: { key: request.projectKey },
            issuetype: { name: request.issueType },
            summary: request.summary,
            description: request.description,
            labels: request.labels
          }
        })
      });

      if (!created.ok) {
        // Jira answers a rejected create with a body naming the offending field — an issue
        // type that does not exist in this project, a project key nobody can see, a required
        // custom field the deployment added. That text is the difference between a QA Lead
        // fixing one variable and guessing, so it is quoted rather than discarded. It is
        // third-party text and `sanitizeFailureReason` runs over it before it is stored.
        let detail = "";
        try {
          const body = (await created.json()) as {
            errorMessages?: unknown;
            errors?: Record<string, unknown>;
          };
          const messages = Array.isArray(body.errorMessages) ? body.errorMessages.map(String) : [];
          const fields = body.errors
            ? Object.entries(body.errors).map(([field, message]) => `${field}: ${String(message)}`)
            : [];
          detail = [...messages, ...fields].join("; ");
        } catch {
          detail = "";
        }

        return createFailed(
          `Jira refused to create the issue (HTTP ${created.status})${detail === "" ? "." : `: ${detail}`}`,
          request.actorId
        );
      }

      // The issue now EXISTS. An unreadable response past this point is the dangerous case,
      // not a harmless one: without the key, QAMS cannot record what it just made, and the
      // retry would raise a duplicate — which is exactly what the label search above is there
      // to catch. Reported as a failure with a reason that says the issue may exist.
      let issueKey: string | null = null;
      try {
        const body = (await created.json()) as { key?: unknown };
        if (typeof body.key === "string") issueKey = body.key;
      } catch {
        issueKey = null;
      }

      if (issueKey === null) {
        return createFailed(
          "Jira accepted the issue but returned no key. The bug may exist; the next attempt will adopt it rather than raise another.",
          request.actorId
        );
      }

      return { outcome: JiraSyncOutcome.SUCCEEDED, issueKey, adopted: false, actorId: request.actorId };
    }
  };
}
