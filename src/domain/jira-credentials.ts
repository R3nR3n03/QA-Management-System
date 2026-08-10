import { JiraSyncOutcome, QamsRole } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { jiraConfig } from "@/lib/jira-config";
import { ensureRole, RoleSets } from "@/lib/rbac";
import { encryptSecret, parseEncryptionKey } from "@/lib/secret-box";

/**
 * A person's own Jira connection: connect, disconnect, and who has one.
 *
 * The credential is *theirs*, not the deployment's — which is why connecting lives on
 * `/account` rather than an admin screen, and why a QA Lead can see THAT someone is
 * connected but never which Jira identity they linked. Publishing a third-party account
 * nobody agreed to publish is not needed to chase a missing connection.
 *
 * The refresh token is encrypted at rest (`src/lib/secret-box.ts`) and never returned by any
 * function here. Nothing in this module hands a caller the plaintext; the transport reads it
 * separately when it actually needs to call Jira.
 */

type Actor = { userId: string; role: QamsRole; requestId: string };

/** A sync waiting to be retried as a particular person. */
export type PendingSync = {
  jiraIssueKey: string;
  executionId: string;
};

/** A row to append when queued work is given up on. */
export type AbandonedSync = {
  executionId: string;
  jiraIssueKey: string;
  outcome: typeof JiraSyncOutcome.ABANDONED;
  failureReason: string;
  /** Always null: the system abandoned this, not the person who disconnected. */
  actorId: null;
};

export type DisconnectDisposition = {
  /** Left for the retry worker to replay under the service account. */
  retryAsServiceAccount: PendingSync[];
  /** Given up on, as new append-only rows. */
  abandoned: AbandonedSync[];
};

/**
 * What happens to a person's queued syncs when they disconnect (Q6).
 *
 * Pure, so the consent rule is testable without a database.
 *
 * Keeping the work alive under their revoked credential is the one option ruled out: they
 * withdrew consent, and replaying as them afterwards is precisely what consent existed to
 * prevent. Leaving it queued forever is the same lie told more slowly, so with no service
 * account the work is abandoned and surfaced to a QA Lead instead.
 */
export function resolveDisconnectDisposition(
  pending: PendingSync[],
  hasServiceAccountFallback: boolean
): DisconnectDisposition {
  if (hasServiceAccountFallback) {
    return { retryAsServiceAccount: pending, abandoned: [] };
  }

  return {
    retryAsServiceAccount: [],
    abandoned: pending.map((item) => ({
      executionId: item.executionId,
      jiraIssueKey: item.jiraIssueKey,
      outcome: JiraSyncOutcome.ABANDONED,
      failureReason:
        "The user disconnected their Jira account and no service account is configured, so this sync cannot be retried.",
      actorId: null
    }))
  };
}

/**
 * Store or replace a person's Jira refresh token.
 *
 * An upsert, because reconnecting is normal — a token expires, or someone links a different
 * Jira account. Past `JiraSyncAttempt` rows keep their original attribution either way (Q7):
 * they are append-only records of who actually performed a write at the time, and rewriting
 * them so a past transition appeared to come from an account that did not make it would be a
 * lie in an audit table.
 */
export async function connectJiraAccount(refreshToken: string, actor: Actor) {
  const config = jiraConfig();
  if (!config.enabled || !config.encryptionKey) {
    throw new AppError(
      422,
      "POLICY_NOT_DEFINED",
      "Jira is not configured for this deployment, so an account cannot be connected."
    );
  }

  // Decoded here rather than in `jiraConfig()`: that module is imported by
  // `instrumentation.ts`, which Next compiles for the Edge runtime where `node:crypto` does
  // not resolve. The key's SHAPE was already checked at boot, so this cannot fail in
  // practice — it is the decode, not the validation.
  const encryptedRefreshToken = encryptSecret(
    refreshToken,
    parseEncryptionKey(config.encryptionKey)
  );

  return prisma.$transaction(async (tx) => {
    const saved = await tx.jiraCredential.upsert({
      where: { userId: actor.userId },
      create: { userId: actor.userId, encryptedRefreshToken },
      update: { encryptedRefreshToken }
    });

    await appendAudit(tx, {
      actorId: actor.userId,
      action: "JIRA_ACCOUNT_CONNECTED",
      entityType: "User",
      entityId: actor.userId,
      requestId: actor.requestId,
      // Deliberately records only THAT a connection exists. No token, no ciphertext, and no
      // Jira identity — audit events are kept forever and read by other people.
      beforeAfterJson: { after: { connected: true, connectedAt: saved.connectedAt } }
    });

    return { connected: true as const, connectedAt: saved.connectedAt };
  });
}

/**
 * Remove a person's Jira connection and settle whatever was queued as them.
 *
 * Deleting the credential is the easy half; the queued work is the half that matters, and
 * `resolveDisconnectDisposition` decides it.
 */
export async function disconnectJiraAccount(actor: Actor) {
  const existing = await prisma.jiraCredential.findUnique({ where: { userId: actor.userId } });
  if (!existing) {
    throw new AppError(404, "REFERENCE_NOT_FOUND", "No Jira account is connected.");
  }

  /**
   * Everything waiting on this person's credential that has not since succeeded.
   *
   * Matching on `actorId` alone was wrong and found almost nothing. The failures that
   * actually correspond to an unusable per-user credential are recorded with `actorId: null`
   * — nobody performed the write, which is the point — so the syncs most in need of settling
   * here were invisible to it. The execution's tester is the durable link between a queued
   * sync and the person whose credential it is waiting on.
   */
  const failures = await prisma.jiraSyncAttempt.findMany({
    where: {
      outcome: JiraSyncOutcome.FAILED,
      OR: [{ actorId: actor.userId }, { execution: { testerId: actor.userId } }]
    },
    select: { executionId: true, jiraIssueKey: true }
  });

  const settled = await prisma.jiraSyncAttempt.findMany({
    where: {
      jiraIssueKey: { in: failures.map((row) => row.jiraIssueKey) },
      outcome: { in: [JiraSyncOutcome.SUCCEEDED, JiraSyncOutcome.ABANDONED] }
    },
    select: { jiraIssueKey: true }
  });
  const alreadySettled = new Set(settled.map((row) => row.jiraIssueKey));

  const pending: PendingSync[] = failures.filter((row) => !alreadySettled.has(row.jiraIssueKey));
  const disposition = resolveDisconnectDisposition(pending, jiraConfig().serviceAccountFallback);

  return prisma.$transaction(async (tx) => {
    await tx.jiraCredential.delete({ where: { userId: actor.userId } });

    // Appended, never an update: a sync attempt is a record of what happened at a moment,
    // and giving up is a new thing that happened.
    for (const row of disposition.abandoned) {
      await tx.jiraSyncAttempt.create({ data: row });
    }

    await appendAudit(tx, {
      actorId: actor.userId,
      action: "JIRA_ACCOUNT_DISCONNECTED",
      entityType: "User",
      entityId: actor.userId,
      requestId: actor.requestId,
      beforeAfterJson: {
        before: { connected: true },
        after: {
          connected: false,
          abandonedSyncs: disposition.abandoned.length,
          handedToServiceAccount: disposition.retryAsServiceAccount.length
        }
      }
    });

    return {
      connected: false as const,
      abandoned: disposition.abandoned.length,
      handedToServiceAccount: disposition.retryAsServiceAccount.length
    };
  });
}

/** Whether this person has a Jira connection. The only thing `/account` needs to render. */
export async function jiraConnectionFor(userId: string) {
  const credential = await prisma.jiraCredential.findUnique({
    where: { userId },
    // Never selects the token. Nothing on a screen needs it, so nothing loads it.
    select: { connectedAt: true }
  });

  return credential === null
    ? { connected: false as const, connectedAt: null }
    : { connected: true as const, connectedAt: credential.connectedAt };
}

/**
 * Who has connected — the roster a QA Lead uses to chase the gap (Q5).
 *
 * State only. Deliberately no Jira account, email or identity of any kind: a Lead needs to
 * know who still has to connect, and never needs to know which third-party account someone
 * linked to do it.
 */
export async function jiraConnectionRoster(actor: Actor) {
  ensureRole([...RoleSets.canAdmin], actor.role);

  const [users, connected] = await Promise.all([
    prisma.user.findMany({
      where: { active: true },
      select: { id: true, displayName: true },
      orderBy: { displayName: "asc" }
    }),
    prisma.jiraCredential.findMany({ select: { userId: true, connectedAt: true } })
  ]);

  const byUser = new Map(connected.map((row) => [row.userId, row.connectedAt]));

  const rows = users.map((user) => ({
    userId: user.id,
    displayName: user.displayName,
    connected: byUser.has(user.id),
    connectedAt: byUser.get(user.id) ?? null
  }));

  return { rows, connectedCount: rows.filter((row) => row.connected).length, total: rows.length };
}
