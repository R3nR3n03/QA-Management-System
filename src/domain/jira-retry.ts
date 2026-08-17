import { DefectLifecycleState, JiraDefectAction, JiraSyncOutcome } from "@prisma/client";
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
import {
  recordDefectAbandonment,
  settleDefectIssueCreate,
  settleDefectIssueTransition
} from "@/domain/jira-defect-sync";

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
 * One defect's outstanding Jira work.
 *
 * Keyed by defect AND action, because a defect can fail both halves independently: a create
 * that never landed and a transition that could not move an issue are separate stories with
 * separate budgets.
 */
export type DefectAttemptSummary = {
  defectId: string;
  /** CREATE or TRANSITION. A COMMENT is never retried and never reaches this queue. */
  action: JiraDefectAction;
  failureCount: number;
  /** The defect's Jira key, or null when the create never produced one. */
  jiraIssueKey: string | null;
  /** Who a new attempt is attributed to — the person who raised the defect. */
  actorId: string;
};

export type DefectAbandonedRow = DefectAttemptSummary & { failureReason: string };

export type DefectRetryPlan = {
  retry: DefectAttemptSummary[];
  abandon: DefectAbandonedRow[];
};

/**
 * Sorts the defect queue into "try again" and "give up", on the same budget as the execution
 * queue and for the same reason: a queue that retries indefinitely hides a permanently broken
 * credential.
 *
 * Pure, so the rule is testable without a database or a clock. Every item lands in exactly one
 * bucket. It is a sibling of `planRetries` rather than a reuse of it — the two carry different
 * identities and word their abandonment differently, and collapsing them would mean a shape
 * that is neither.
 */
export function planDefectRetries(queue: DefectAttemptSummary[]): DefectRetryPlan {
  const plan: DefectRetryPlan = { retry: [], abandon: [] };

  for (const item of queue) {
    if (item.failureCount >= MAX_SYNC_ATTEMPTS) {
      plan.abandon.push({
        ...item,
        failureReason:
          item.action === JiraDefectAction.CREATE
            ? `Gave up after ${item.failureCount} failed attempts to raise a Jira issue. A QA Lead must raise it by hand, or this defect stays untracked in Jira.`
            : `Gave up after ${item.failureCount} failed attempts. A QA Lead must close this in Jira, or the issue stays open.`
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
 * The defect queue: creates and transitions whose latest word is a failure.
 *
 * An action is settled the moment ANY attempt for that (defect, action) succeeded or was
 * abandoned — attempts are append-only, so "settled" is the presence of a terminal row rather
 * than the absence of failures, exactly as on the execution side.
 *
 * Two settlements have no terminal row and are checked against the defect itself:
 *
 * - a CREATE whose defect now HOLDS a key succeeded, however it got there;
 * - a TRANSITION whose defect is no longer Closed must not be retried at all. The defect was
 *   reopened after the transition failed, and retrying would close a Jira issue for work that
 *   is back in progress — the retry running long after the request that queued it is exactly
 *   what makes this reachable.
 */
async function loadDefectQueue(): Promise<DefectAttemptSummary[]> {
  const retryable = [JiraDefectAction.CREATE, JiraDefectAction.TRANSITION];

  const failures = await prisma.jiraDefectAttempt.groupBy({
    by: ["defectId", "action"],
    where: { outcome: JiraSyncOutcome.FAILED, action: { in: retryable } },
    _count: { _all: true }
  });
  if (failures.length === 0) return [];

  const defectIds = [...new Set(failures.map((row) => row.defectId))];

  const settled = await prisma.jiraDefectAttempt.findMany({
    where: {
      defectId: { in: defectIds },
      action: { in: retryable },
      outcome: { in: [JiraSyncOutcome.SUCCEEDED, JiraSyncOutcome.ABANDONED] }
    },
    select: { defectId: true, action: true }
  });
  const done = new Set(settled.map((row) => `${row.defectId}:${row.action}`));

  const defects = await prisma.defect.findMany({
    where: { id: { in: defectIds } },
    select: { id: true, status: true, jiraIssueKey: true, createdBy: true }
  });
  const byId = new Map(defects.map((defect) => [defect.id, defect]));

  return failures.flatMap((row) => {
    if (done.has(`${row.defectId}:${row.action}`)) return [];

    const defect = byId.get(row.defectId);
    // The defect was removed, so there is nothing to attribute an attempt to and nothing left
    // that this Jira work was tracking.
    if (!defect) return [];

    if (row.action === JiraDefectAction.CREATE && defect.jiraIssueKey !== null) return [];
    if (row.action === JiraDefectAction.TRANSITION && defect.status !== DefectLifecycleState.CLOSED) {
      return [];
    }

    return [
      {
        defectId: defect.id,
        action: row.action,
        failureCount: row._count._all,
        jiraIssueKey: defect.jiraIssueKey,
        // The person who raised the defect. They caused this work to exist; it is not a claim
        // that they triggered the retry, which no human did.
        actorId: defect.createdBy
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
  /**
   * The defect queue's own tallies, reported separately rather than folded into the totals
   * above. An operator reading "3 failed" needs to know whether three tickets did not close or
   * three bugs were never raised — the second is a defect nobody outside QAMS can see, and the
   * two want different responses.
   */
  defects: { attempted: number; succeeded: number; failed: number; abandoned: number };
}> {
  const config = jiraConfig();
  const summary = {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    abandoned: 0,
    defects: { attempted: 0, succeeded: 0, failed: 0, abandoned: 0 }
  };
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

  // The defect pass, worked by the same scheduled call. A deployment that has not set a defect
  // project key loads an empty queue and does nothing, because nothing ever wrote a defect
  // attempt row for it to find.
  const defectPlan = planDefectRetries(await loadDefectQueue());

  for (const row of defectPlan.abandon) {
    await recordDefectAbandonment(
      row.defectId,
      row.action,
      row.jiraIssueKey,
      row.actorId,
      "jira-retry",
      row.failureReason
    );
    summary.defects.abandoned += 1;
  }

  for (const item of defectPlan.retry) {
    summary.defects.attempted += 1;

    // Driven through the same settle functions the defect service uses, rather than a second
    // copy of the Jira-calling logic here. They re-read the defect, record their own attempt
    // row and audit event, and never throw — so a retry and a first attempt cannot drift into
    // recording different things about the same call.
    const actor = { userId: item.actorId, role: undefined, requestId: "jira-retry" };
    const outcome =
      item.action === JiraDefectAction.CREATE
        ? await settleDefectIssueCreate(item.defectId, actor)
        : await settleDefectIssueTransition(item.defectId, actor);

    if (outcome === JiraSyncOutcome.SUCCEEDED) summary.defects.succeeded += 1;
    // A null means nothing was attempted — the transport is not installed, or the work was
    // already settled between loading the queue and getting here. Counted as neither, because
    // calling it a failure would keep an issue in a queue it has already left.
    else if (outcome === JiraSyncOutcome.FAILED) summary.defects.failed += 1;
  }

  logRequest({
    occurredAt: new Date().toISOString(),
    requestId: "jira-retry",
    status: 200,
    action: "JIRA_SYNC_RETRY_RUN",
    message:
      `Jira sync retries: ${summary.attempted} attempted, ${summary.succeeded} succeeded, ${summary.failed} failed, ${summary.abandoned} abandoned. ` +
      `Defects: ${summary.defects.attempted} attempted, ${summary.defects.succeeded} succeeded, ${summary.defects.failed} failed, ${summary.defects.abandoned} abandoned.`
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
