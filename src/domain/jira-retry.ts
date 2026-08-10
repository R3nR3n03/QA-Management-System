import { JiraSyncOutcome } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { jiraConfig } from "@/lib/jira-config";
import { logRequest } from "@/lib/logging";
import {
  getJiraTransport,
  sanitizeFailureReason,
  setJiraTransport,
  type JiraTransitionResult
} from "@/domain/jira-sync";

/**
 * Retrying a Jira sync that failed, and giving up when it cannot succeed.
 *
 * `settleJiraSync` attempts a transition once, at finalize, and records the outcome. Without
 * this, a `FAILED` row was the end of the story: a Jira that was down for ten minutes meant
 * a ticket that stayed open forever, with nothing to notice it.
 *
 * ## Why giving up is a feature
 *
 * A queue that retries indefinitely hides a permanently broken credential — the sync looks
 * busy rather than broken, and nobody is ever prompted to fix it. After a bounded number of
 * attempts an issue reaches the terminal `ABANDONED` state, which is what surfaces it to a
 * QA Lead. That is the documented behaviour
 * (`docs/testing-and-acceptance.md`: "Exhaust the retry budget").
 */

/**
 * How many times one issue may be attempted before it is abandoned.
 *
 * A deployment default, not a documented policy value — the knowledge base sets no retry
 * budget, and `docs/README.md` forbids inventing one as policy. It is stated here as an
 * engineering default and wants QA Lead confirmation like the rate limits do.
 */
export const MAX_SYNC_ATTEMPTS = 5;

/** One issue key's standing in the queue. */
export type AttemptSummary = {
  jiraIssueKey: string;
  /** The execution to attribute a new attempt row to. */
  executionId: string;
  /** How many times it has already failed. */
  failureCount: number;
};

export type AbandonedRow = {
  executionId: string;
  jiraIssueKey: string;
  outcome: typeof JiraSyncOutcome.ABANDONED;
  failureReason: string;
  actorId: null;
};

export type RetryPlan = {
  retry: AttemptSummary[];
  abandon: AbandonedRow[];
};

/**
 * Sorts a queue into "try again" and "give up", by attempt count alone.
 *
 * Pure, so the budget rule is testable without a database or a clock. Every issue lands in
 * exactly one bucket.
 */
export function planRetries(queue: AttemptSummary[]): RetryPlan {
  const plan: RetryPlan = { retry: [], abandon: [] };

  for (const item of queue) {
    if (item.failureCount >= MAX_SYNC_ATTEMPTS) {
      plan.abandon.push({
        executionId: item.executionId,
        jiraIssueKey: item.jiraIssueKey,
        outcome: JiraSyncOutcome.ABANDONED,
        failureReason: `Gave up after ${item.failureCount} failed attempts. A QA Lead must resolve this in Jira, or the issue stays open.`,
        // A system decision, not a person's.
        actorId: null
      });
    } else {
      plan.retry.push(item);
    }
  }

  return plan;
}

/**
 * The queue: issue keys whose latest word is a failure.
 *
 * An issue is settled the moment ANY attempt for it succeeded or was abandoned — attempts are
 * append-only, so "settled" is the presence of a terminal row rather than the absence of
 * failures. Grouping by issue key rather than by execution matters because several executions
 * share one key and the transition is a property of the key.
 */
async function loadQueue(): Promise<AttemptSummary[]> {
  const failures = await prisma.jiraSyncAttempt.groupBy({
    by: ["jiraIssueKey"],
    where: { outcome: JiraSyncOutcome.FAILED },
    _count: { _all: true }
  });
  if (failures.length === 0) return [];

  const keys = failures.map((row) => row.jiraIssueKey);

  const settled = await prisma.jiraSyncAttempt.findMany({
    where: {
      jiraIssueKey: { in: keys },
      outcome: { in: [JiraSyncOutcome.SUCCEEDED, JiraSyncOutcome.ABANDONED] }
    },
    select: { jiraIssueKey: true }
  });
  const done = new Set(settled.map((row) => row.jiraIssueKey));

  const open = failures.filter((row) => !done.has(row.jiraIssueKey));
  if (open.length === 0) return [];

  // Any execution carrying the key will do as the attribution target; the newest is the one a
  // reader would expect to find the attempt under.
  const executions = await prisma.testExecution.findMany({
    where: { jiraIssueKey: { in: open.map((row) => row.jiraIssueKey) } },
    select: { id: true, jiraIssueKey: true, testerId: true },
    orderBy: { createdAt: "desc" }
  });
  const executionFor = new Map<string, { id: string; testerId: string }>();
  for (const execution of executions) {
    if (execution.jiraIssueKey && !executionFor.has(execution.jiraIssueKey)) {
      executionFor.set(execution.jiraIssueKey, { id: execution.id, testerId: execution.testerId });
    }
  }

  return open.flatMap((row) => {
    const execution = executionFor.get(row.jiraIssueKey);
    // The execution was removed, so there is nothing to attribute an attempt to and nothing
    // left that this issue was verifying.
    if (!execution) return [];
    return [
      {
        jiraIssueKey: row.jiraIssueKey,
        executionId: execution.id,
        failureCount: row._count._all
      }
    ];
  });
}

/**
 * Works the queue once. Safe to call repeatedly; intended to be driven by a scheduler.
 *
 * Returns a summary rather than throwing, because a caller is a cron job and a thrown error
 * there is a silent failure. Individual attempt failures are recorded and never propagate.
 */
export async function runJiraSyncRetries(): Promise<{
  attempted: number;
  succeeded: number;
  failed: number;
  abandoned: number;
}> {
  const config = jiraConfig();
  const summary = { attempted: 0, succeeded: 0, failed: 0, abandoned: 0 };
  if (!config.enabled) return summary;

  let transport = getJiraTransport();
  if (!transport) {
    // Same lazy installation as `settleJiraSync`, and for the same reason: this module
    // reaches the database, so it can import the transport safely where instrumentation
    // cannot.
    const { createJiraTransport } = await import("@/domain/jira-transport");
    transport = createJiraTransport();
    setJiraTransport(transport);
  }

  const plan = planRetries(await loadQueue());

  for (const row of plan.abandon) {
    await recordAttempt(row, "JIRA_SYNC_ABANDONED");
    summary.abandoned += 1;
  }

  for (const item of plan.retry) {
    summary.attempted += 1;

    const execution = await prisma.testExecution.findUnique({
      where: { id: item.executionId },
      select: { testerId: true }
    });
    if (!execution) continue;

    let result: JiraTransitionResult;
    try {
      result = await transport.transitionToDone({
        issueKey: item.jiraIssueKey,
        executionId: item.executionId,
        actorId: execution.testerId,
        timeoutMs: config.timeoutMs
      });
    } catch (error) {
      result = {
        outcome: JiraSyncOutcome.FAILED,
        failureReason: sanitizeFailureReason(
          error instanceof Error ? error.message : "Unknown transport failure."
        ),
        actorId: null
      };
    }

    await recordAttempt(
      {
        executionId: item.executionId,
        jiraIssueKey: item.jiraIssueKey,
        outcome: result.outcome,
        failureReason: result.failureReason ? sanitizeFailureReason(result.failureReason) : null,
        actorId: result.actorId ?? null
      },
      "JIRA_SYNC_RETRIED"
    );

    if (result.outcome === JiraSyncOutcome.SUCCEEDED) summary.succeeded += 1;
    else summary.failed += 1;
  }

  logRequest({
    occurredAt: new Date().toISOString(),
    requestId: "jira-retry",
    status: 200,
    action: "JIRA_SYNC_RETRY_RUN",
    message: `Jira sync retries: ${summary.attempted} attempted, ${summary.succeeded} succeeded, ${summary.failed} failed, ${summary.abandoned} abandoned.`
  });

  return summary;
}

/** One append-only attempt row and its audit event, written together. */
async function recordAttempt(
  row: {
    executionId: string;
    jiraIssueKey: string;
    outcome: JiraSyncOutcome;
    failureReason?: string | null;
    actorId: string | null;
  },
  action: string
): Promise<void> {
  /**
   * Two different "who", deliberately.
   *
   * The attempt row's `actorId` is whose CREDENTIAL performed the Jira write, and is null
   * when none did — a retry that failed on a missing token was performed by nobody.
   *
   * The audit event's `actorId` must resolve to a real user forever
   * (`docs/data-model.md`), and no human triggers a retry, so it records the tester whose run
   * created the work. That is honest: they caused this sync to exist. It is not a claim that
   * they clicked anything.
   */
  const execution = await prisma.testExecution.findUnique({
    where: { id: row.executionId },
    select: { testerId: true }
  });
  if (!execution) return;

  await prisma.$transaction(async (tx) => {
    const attempt = await tx.jiraSyncAttempt.create({
      data: {
        executionId: row.executionId,
        jiraIssueKey: row.jiraIssueKey,
        outcome: row.outcome,
        failureReason: row.failureReason ?? null,
        actorId: row.actorId
      }
    });
    await appendAudit(tx, {
      actorId: execution.testerId,
      action,
      entityType: "Execution",
      entityId: row.executionId,
      requestId: "jira-retry",
      beforeAfterJson: {
        after: {
          jiraIssueKey: attempt.jiraIssueKey,
          outcome: attempt.outcome,
          failureReason: attempt.failureReason,
          // Null means no human credential performed it — the service account did, or it
          // failed before reaching Jira.
          performedByUserId: attempt.actorId
        }
      }
    });
  });
}
