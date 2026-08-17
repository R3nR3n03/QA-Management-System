import {
  DefectLifecycleState,
  JiraDefectAction,
  JiraSyncOutcome,
  type Prisma
} from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { appBaseUrl, defectUrl, organizationTimeZone } from "@/lib/app-config";
import { UTC } from "@/lib/time-zone";
import { prisma } from "@/lib/db";
import { jiraConfig } from "@/lib/jira-config";
import { logRequest } from "@/lib/logging";
import {
  getJiraTransport,
  sanitizeFailureReason,
  setJiraTransport,
  type JiraCommentResult,
  type JiraCreateIssueResult,
  type JiraTransitionResult
} from "@/domain/jira-sync";
import {
  buildDefectIssueFields,
  buildDefectLifecycleComment,
  shouldTransitionDefectIssue,
  type DefectTransitionNote
} from "@/domain/jira-defect";

/**
 * The impure half of the defect sync: the calls to Jira, and the append-only record of how
 * each one went (`docs/architecture.md#Jira defect sync`, ADR-0006).
 *
 * `jira-defect.ts` decides WHAT is written and WHETHER an issue should move; nothing here
 * decides anything. The split is the one `jira-sync.ts` and `jira-transport.ts` already use,
 * and it is why the rules that can corrupt someone else's project are testable without a
 * database.
 *
 * ## Nothing in this file ever throws
 *
 * Every entry point is called AFTER the defect's own transaction has committed, and each one
 * swallows its failures into a recorded attempt and a log line. A defect is QAMS's record and
 * Jira is a projection of it: an unreachable Jira must never cost someone the defect they
 * raised, exactly as an unreachable Jira must never cost a tester their results (ADR-0003).
 *
 * ## Why no external call runs inside a transaction
 *
 * The same rule the execution sync follows. Holding a pool connection open across third-party
 * network I/O is what turns a slow Jira into a database outage. The one place the codebase
 * accepts it is the rotating-refresh-token exchange in `jira-transport.ts`, which documents
 * why it is the lesser harm there.
 */

/** The actor shape the defect service already carries. */
type Actor = { userId: string; role: unknown; requestId: string };

/**
 * The Jira transport, installed on first use, or `null` when the defect sync is off.
 *
 * Lazily imported for the reason `executions.ts` documents: the transport reaches
 * `src/lib/db.ts` and therefore `pg` and `node:fs`, which `instrumentation.ts` cannot pull in
 * because Next compiles that file for the Edge runtime too.
 *
 * Returns null when Jira is not configured at all. Whether a given defect raises a bug is a
 * second question, answered per defect by its product's `jiraProjectKey` — a deployment
 * connected to Jira purely for execution transitions has no product carrying one, so nothing
 * here ever calls out.
 */
async function defectTransport() {
  const config = jiraConfig();
  if (!config.enabled) return null;

  const existing = getJiraTransport();
  if (existing) return existing;

  const { createJiraTransport } = await import("@/domain/jira-transport");
  const transport = createJiraTransport();
  setJiraTransport(transport);
  return transport;
}

/** A thrown value, as a stored reason. Mirrors `failureReasonOf` in `executions.ts`. */
function failureReasonOf(error: unknown): string {
  return sanitizeFailureReason(error instanceof Error ? error.message : "Unknown transport failure.");
}

/** One append-only attempt row and its audit event, written together. */
async function recordAttempt(
  row: {
    defectId: string;
    action: JiraDefectAction;
    jiraIssueKey: string | null;
    outcome: JiraSyncOutcome;
    jiraCommentId?: string | null;
    failureReason?: string | null;
    actorId: string | null;
  },
  auditActorId: string,
  requestId: string,
  action: string,
  tx?: Prisma.TransactionClient
): Promise<void> {
  const write = async (client: Prisma.TransactionClient) => {
    const attempt = await client.jiraDefectAttempt.create({
      data: {
        defectId: row.defectId,
        action: row.action,
        jiraIssueKey: row.jiraIssueKey,
        outcome: row.outcome,
        jiraCommentId: row.jiraCommentId ?? null,
        failureReason: row.failureReason ?? null,
        actorId: row.actorId
      }
    });
    /**
     * Two different "who", the same distinction `jira-retry.ts` draws.
     *
     * The attempt row's `actorId` is whose CREDENTIAL performed the Jira write, and is null
     * when none did. The audit event's actor must resolve to a real user forever
     * (`docs/data-model.md`), so it names the person whose action caused the sync to exist —
     * which is honest, and is not a claim that they clicked anything in Jira.
     */
    await appendAudit(client, {
      actorId: auditActorId,
      action,
      entityType: "Defect",
      entityId: row.defectId,
      requestId,
      beforeAfterJson: {
        after: {
          jiraAction: attempt.action,
          jiraIssueKey: attempt.jiraIssueKey,
          outcome: attempt.outcome,
          jiraCommentId: attempt.jiraCommentId,
          failureReason: attempt.failureReason,
          // Null means no human credential performed it — the service account did, or it
          // failed before reaching Jira.
          performedByUserId: attempt.actorId
        }
      }
    });
  };

  if (tx) return write(tx);
  await prisma.$transaction(write);
}

/** What a caller needs to hold about a defect before raising its bug. */
export type DefectIssueSubject = {
  id: string;
  businessId: string;
  summary: string;
  priority: string;
  severity: string;
  jiraIssueKey: string | null;
};

/**
 * Raise the Jira bug for a newly created defect, and store the key it comes back with.
 *
 * Never throws. Called after `createDefect` has committed, so there is nothing a thrown error
 * could roll back and every failure here is a Jira problem rather than a QAMS one.
 *
 * Returns the outcome recorded, or `null` when nothing was attempted at all — the distinction
 * the retry worker needs to report honestly, since "Jira is off" and "the call failed" are the
 * same silence from the outside.
 *
 * ## Why the key is written outside the create transaction
 *
 * It has to be: the call that produces the key is network I/O, and no external call may run
 * while a transaction is open. The cost is a window in which Jira holds an issue QAMS has not
 * recorded yet, and that window is exactly what the label search in `createIssue` closes — a
 * retry finds the orphan and adopts it rather than raising a second bug.
 */
export async function settleDefectIssueCreate(
  defectId: string,
  actor: Actor
): Promise<JiraSyncOutcome | null> {
  try {
    const transport = await defectTransport();
    if (!transport) return null;

    const config = jiraConfig();

    // Read after the transaction rather than joined into it: the create transaction writes
    // someone's defect and must stay as short as it already is.
    //
    // The product comes along because it owns the answer to "which Jira project?". A defect
    // reaches its product the only way it can — through the single test case it was raised
    // against (`docs/data-model.md`).
    const defect = await prisma.defect.findUnique({
      where: { id: defectId },
      select: {
        id: true,
        businessId: true,
        summary: true,
        priority: true,
        severity: true,
        jiraIssueKey: true,
        testCase: {
          select: {
            businessId: true,
            title: true,
            product: { select: { jiraProjectKey: true } }
          }
        }
      }
    });
    if (!defect) return null;

    /**
     * This product raises no bugs. Not an error, and deliberately not a recorded attempt:
     * it is the default for every product, and writing a row per defect to say "nobody asked
     * for this" would fill an append-only table with the absence of a decision.
     *
     * It is also the switch that keeps the whole feature off until a QA Lead names a project
     * — the property the retired `JIRA_DEFECT_PROJECT_KEY` used to carry (ADR-0006).
     */
    const projectKey = defect.testCase.product.jiraProjectKey;
    if (projectKey === null) return null;

    // Already raised. Not an error and not worth a row: this is the ordinary answer when a
    // retry runs after a create that succeeded, and recording an attempt that was never made
    // would put a false row in an append-only table.
    if (defect.jiraIssueKey !== null) return null;

    const reporter = await prisma.user.findUnique({
      where: { id: actor.userId },
      select: { displayName: true }
    });

    const fields = buildDefectIssueFields({
      defectBusinessId: defect.businessId,
      summary: defect.summary,
      priority: defect.priority,
      severity: defect.severity,
      testCaseBusinessId: defect.testCase.businessId,
      testCaseTitle: defect.testCase.title,
      // A user row is never deleted, so this falls back only if the actor is a system caller.
      reporterName: reporter?.displayName ?? "QAMS",
      defectUrl: defectUrl(appBaseUrl(), defect.id)
    });

    // A transport that REJECTS is the ordinary shape of a network failure and is recorded
    // exactly like one that resolves FAILED — otherwise the record stays empty precisely when
    // Jira is down.
    let result: JiraCreateIssueResult;
    try {
      result = await transport.createIssue({
        projectKey,
        issueType: config.defectIssueType,
        summary: fields.summary,
        description: fields.description,
        labels: fields.labels,
        defectId: defect.id,
        actorId: actor.userId,
        timeoutMs: config.timeoutMs
      });
    } catch (error) {
      result = {
        outcome: JiraSyncOutcome.FAILED,
        failureReason: failureReasonOf(error),
        actorId: null
      };
    }

    const issueKey = result.issueKey ?? null;

    await prisma.$transaction(async (tx) => {
      if (result.outcome === JiraSyncOutcome.SUCCEEDED && issueKey !== null) {
        /**
         * Conditional on the key still being unset, which is what makes this safe against two
         * creates racing for one defect.
         *
         * `updateMany` rather than `update`: it matches zero rows instead of throwing when
         * another attempt won, and losing that race is a normal outcome rather than an error.
         * The attempt row below is still written either way, because the call to Jira really
         * did happen and the append-only log records what happened, not what was kept.
         *
         * `Defect.jiraIssueKey` is unique, so a second defect cannot claim an issue already
         * bound to another one — the constraint, not this code, is what guarantees it.
         */
        await tx.defect.updateMany({
          where: { id: defect.id, jiraIssueKey: null },
          data: { jiraIssueKey: issueKey }
        });
      }

      await recordAttempt(
        {
          defectId: defect.id,
          action: JiraDefectAction.CREATE,
          jiraIssueKey: issueKey,
          outcome: result.outcome,
          failureReason: result.failureReason ? sanitizeFailureReason(result.failureReason) : null,
          actorId: result.actorId ?? null
        },
        actor.userId,
        actor.requestId,
        // Adoption is called out in the audit action rather than buried in a field: it is the
        // one success that means "an earlier attempt had already raised this", which is what a
        // reader investigating a duplicate needs to see first.
        result.adopted === true ? "JIRA_DEFECT_ISSUE_ADOPTED" : "JIRA_DEFECT_ISSUE_CREATED",
        tx
      );
    });

    return result.outcome;
  } catch (error) {
    // Cannot fail the defect create: it is already committed. Must still be visible — a silent
    // failure here is how QAMS and Jira drift apart unobserved.
    logRequest({
      occurredAt: new Date().toISOString(),
      requestId: actor.requestId,
      status: 500,
      actorId: actor.userId,
      action: "JIRA_DEFECT_CREATE_FAILED",
      message: `Jira issue could not be raised for defect ${defectId}: ${failureReasonOf(error)}`
    });
    return null;
  }
}

/** What one lifecycle transition needs to say in Jira. */
export type DefectTransitionSubject = {
  defectId: string;
  from: DefectLifecycleState;
  to: DefectLifecycleState;
  notes: DefectTransitionNote[];
};

/**
 * Narrate a lifecycle transition on the defect's Jira issue, then move the issue if the defect
 * closed.
 *
 * Never throws. Called after `transitionDefect` has committed.
 *
 * The comment goes FIRST so a reader scrolling the issue finds "here is what changed and why"
 * immediately above the status change — the order that reads correctly, and the same ordering
 * decision `finalizeExecution` makes. The two are independent: each has its own deadline, and
 * a comment that could not post must never cost the transition, which is the half that carries
 * meaning (ADR-0004).
 */
export async function settleDefectTransition(
  subject: DefectTransitionSubject,
  actor: Actor
): Promise<void> {
  await settleDefectComment(subject, actor);
  if (shouldTransitionDefectIssue(subject.to)) {
    await settleDefectIssueTransition(subject.defectId, actor);
  }
}

/**
 * Post the lifecycle comment, and record the attempt.
 *
 * There is no retry and no recovery, exactly as for an execution's result comment: a missing
 * comment is cosmetic, QAMS holds the record either way, so the attempt is recorded, surfaced
 * on the defect screen, and never chased. The retry worker queues on CREATE and TRANSITION and
 * ignores this action by construction.
 */
async function settleDefectComment(subject: DefectTransitionSubject, actor: Actor): Promise<void> {
  try {
    const transport = await defectTransport();
    if (!transport) return;

    const defect = await prisma.defect.findUnique({
      where: { id: subject.defectId },
      select: { id: true, businessId: true, jiraIssueKey: true, updatedAt: true }
    });
    // No issue means the create has not succeeded yet. Nothing to comment on, and nothing
    // worth recording: the failed CREATE is already the story, and a COMMENT row saying "no
    // issue" would duplicate it once per transition.
    if (!defect || defect.jiraIssueKey === null) return;

    const actorUser = await prisma.user.findUnique({
      where: { id: actor.userId },
      select: { displayName: true }
    });

    const body = buildDefectLifecycleComment({
      defectBusinessId: defect.businessId,
      from: subject.from,
      to: subject.to,
      actorName: actorUser?.displayName ?? "QAMS",
      // The instant the transition was persisted, rather than a fresh `new Date()`. The two
      // differ by however long Jira took to answer, and the comment reports when the defect
      // moved, not when this code got round to saying so.
      occurredAt: defect.updatedAt,
      notes: subject.notes,
      defectUrl: defectUrl(appBaseUrl(), defect.id),
      // The ORGANIZATION zone, like every other stamp QAMS writes into somebody else's
      // project. The person reading this comment is a developer on that project, not a QAMS
      // user with a zone of their own (ADR-0007).
      timeZone: organizationTimeZone() ?? UTC
    });

    let result: JiraCommentResult;
    try {
      result = await transport.postComment({
        issueKey: defect.jiraIssueKey,
        defectId: defect.id,
        actorId: actor.userId,
        body,
        timeoutMs: jiraConfig().timeoutMs
      });
    } catch (error) {
      result = { outcome: "FAILED", failureReason: failureReasonOf(error), actorId: null };
    }

    await recordAttempt(
      {
        defectId: defect.id,
        action: JiraDefectAction.COMMENT,
        jiraIssueKey: defect.jiraIssueKey,
        // `JiraCommentOutcome` has no ABANDONED because a comment is never retried; the two
        // values it does have carry the same names as their `JiraSyncOutcome` counterparts,
        // which is what lets one column hold both without inventing a state.
        outcome:
          result.outcome === "SUCCEEDED" ? JiraSyncOutcome.SUCCEEDED : JiraSyncOutcome.FAILED,
        jiraCommentId: result.commentId ?? null,
        failureReason: result.failureReason ? sanitizeFailureReason(result.failureReason) : null,
        actorId: result.actorId ?? null
      },
      actor.userId,
      actor.requestId,
      "JIRA_DEFECT_COMMENT_ATTEMPTED"
    );
  } catch (error) {
    logRequest({
      occurredAt: new Date().toISOString(),
      requestId: actor.requestId,
      status: 500,
      actorId: actor.userId,
      action: "JIRA_DEFECT_COMMENT_FAILED",
      message: `Jira lifecycle comment could not be settled for defect ${subject.defectId}: ${failureReasonOf(error)}`
    });
  }
}

/**
 * Move the defect's Jira issue to a done status, and record the attempt.
 *
 * Exported so the retry worker can drive it for a transition that failed the first time. It
 * re-reads the defect's state rather than trusting the caller: a retry runs long after the
 * request that queued it, and a defect that has since been reopened must not have its issue
 * closed by a retry of the transition that closed it before.
 */
export async function settleDefectIssueTransition(
  defectId: string,
  actor: Actor
): Promise<JiraSyncOutcome | null> {
  try {
    const transport = await defectTransport();
    if (!transport) return null;

    const defect = await prisma.defect.findUnique({
      where: { id: defectId },
      select: { id: true, status: true, jiraIssueKey: true }
    });
    if (!defect || defect.jiraIssueKey === null) return null;

    // Re-checked here, not only at the call site. See the note above on retries.
    if (!shouldTransitionDefectIssue(defect.status)) {
      await recordAttempt(
        {
          defectId: defect.id,
          action: JiraDefectAction.TRANSITION,
          jiraIssueKey: defect.jiraIssueKey,
          // A decision NOT to call Jira, recorded rather than returned from silently — the
          // same reason `recordSyncSkip` exists on the execution side (ADR-0005). Inert to the
          // retry worker, which queues on FAILED.
          outcome: JiraSyncOutcome.SKIPPED,
          failureReason: `The defect is ${defect.status}, not Closed, so its issue was left alone.`,
          // No credential was used, because no call was made.
          actorId: null
        },
        actor.userId,
        actor.requestId,
        "JIRA_DEFECT_TRANSITION_SKIPPED"
      );
      return JiraSyncOutcome.SKIPPED;
    }

    let result: JiraTransitionResult;
    try {
      result = await transport.transitionToDone({
        issueKey: defect.jiraIssueKey,
        defectId: defect.id,
        actorId: actor.userId,
        timeoutMs: jiraConfig().timeoutMs
      });
    } catch (error) {
      result = {
        outcome: JiraSyncOutcome.FAILED,
        failureReason: failureReasonOf(error),
        actorId: null
      };
    }

    await recordAttempt(
      {
        defectId: defect.id,
        action: JiraDefectAction.TRANSITION,
        jiraIssueKey: defect.jiraIssueKey,
        outcome: result.outcome,
        failureReason: result.failureReason ? sanitizeFailureReason(result.failureReason) : null,
        actorId: result.actorId ?? null
      },
      actor.userId,
      actor.requestId,
      "JIRA_DEFECT_TRANSITION_ATTEMPTED"
    );

    return result.outcome;
  } catch (error) {
    logRequest({
      occurredAt: new Date().toISOString(),
      requestId: actor.requestId,
      status: 500,
      actorId: actor.userId,
      action: "JIRA_DEFECT_TRANSITION_FAILED",
      message: `Jira issue could not be transitioned for defect ${defectId}: ${failureReasonOf(error)}`
    });
    return null;
  }
}

/**
 * Record that a defect's Jira work has been given up on.
 *
 * Terminal, and the point of it is to be visible: a queue that retries forever hides a
 * permanently broken credential, because the sync looks busy rather than broken and nobody is
 * ever prompted to fix it. An `ABANDONED` row is what surfaces the issue to a QA Lead
 * (`docs/testing-and-acceptance.md`, and the same reasoning as `jira-retry.ts`).
 *
 * The reason is written by QAMS from its own records and never quotes a third party, so it
 * needs no sanitizing.
 */
export async function recordDefectAbandonment(
  defectId: string,
  action: JiraDefectAction,
  jiraIssueKey: string | null,
  auditActorId: string,
  requestId: string,
  reason: string
): Promise<void> {
  await recordAttempt(
    {
      defectId,
      action,
      jiraIssueKey,
      outcome: JiraSyncOutcome.ABANDONED,
      failureReason: reason,
      // A system decision, not a person's.
      actorId: null
    },
    auditActorId,
    requestId,
    "JIRA_DEFECT_ABANDONED"
  );
}
