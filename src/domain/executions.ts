import {
  ExecutionLifecycleState,
  ExecutionOutcome,
  JiraSyncOutcome,
  Prisma,
  QamsRole,
  TestCaseLifecycleState
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { ensureRole, RoleSets } from "@/lib/rbac";
import { ensureVersion, requireNonBlank } from "@/lib/validation";
import { withVersionCheck } from "@/lib/optimistic-lock";
import { BUSINESS_ID_PATTERNS, ensureBusinessIdFormat } from "@/lib/business-ids";
import { allocateBusinessId, highestSuffix } from "@/lib/id-allocator";
import { ensureActiveControlledValue } from "@/lib/controlled-values";
import { CATALOGUE_PRIORITY, CATALOGUE_SEVERITY } from "@/lib/controlled-value-catalogues";
import { appendAudit } from "@/lib/audit";
import { defectIdFormat } from "@/domain/defects";
import {
  ensureIssueKeyMutable,
  getJiraTransport,
  normalizeJiraIssueKey,
  sanitizeFailureReason,
  shouldTransitionIssue,
  type JiraTransitionResult
} from "@/domain/jira-sync";
import { jiraConfig } from "@/lib/jira-config";
import { logRequest } from "@/lib/logging";
import { runPaged, type PageRequest } from "@/lib/pagination";

type Actor = { userId: string; role: QamsRole; requestId: string };

export type ExecutionListOptions = PageRequest & {
  /** Needle matched against run ID, tester name, covered case ID/title, state and result. */
  query?: string;
  /** Restrict to these lifecycle states. */
  states?: ExecutionLifecycleState[];
  testerId?: string;
  /**
   * Restrict to runs covering at least one case of this product. An execution has no
   * product of its own — it reaches one only through the cases it covers — so a
   * multi-case run spanning two products matches both, which is the honest answer for
   * a filter that asks "which runs touch this product".
   */
  productId?: string;
  /** Same reasoning as `productId`, one level narrower in the hierarchy. */
  featureId?: string;
};

/**
 * The `where` behind every filtered execution read. This is what the executions screen
 * used to do in the browser over every run in the system — including reaching through
 * to the covered cases, which is a `some` here rather than a join the client had to be
 * shipped in full.
 */
function executionWhere(options: ExecutionListOptions): Prisma.TestExecutionWhereInput {
  const needle = options.query?.trim() ?? "";
  const all: Prisma.TestExecutionWhereInput[] = [];

  if (options.states && options.states.length > 0) all.push({ state: { in: options.states } });
  if (options.testerId) all.push({ testerId: options.testerId });
  if (options.productId) {
    all.push({ cases: { some: { testCase: { productId: options.productId } } } });
  }
  if (options.featureId) {
    all.push({ cases: { some: { testCase: { featureId: options.featureId } } } });
  }

  if (needle !== "") {
    const lower = needle.toLowerCase();
    const states = Object.values(ExecutionLifecycleState).filter((s) => s.toLowerCase().includes(lower));
    const outcomes = Object.values(ExecutionOutcome).filter((o) => o.toLowerCase().includes(lower));
    all.push({
      OR: [
        { businessId: { contains: needle, mode: "insensitive" } },
        { tester: { displayName: { contains: needle, mode: "insensitive" } } },
        {
          cases: {
            some: {
              testCase: {
                OR: [
                  { businessId: { contains: needle, mode: "insensitive" } },
                  { title: { contains: needle, mode: "insensitive" } }
                ]
              }
            }
          }
        },
        ...(states.length > 0 ? [{ state: { in: states } }] : []),
        ...(outcomes.length > 0 ? [{ result: { in: outcomes } }] : [])
      ]
    });
  }

  return all.length === 0 ? {} : { AND: all };
}

export async function listExecutions(options: ExecutionListOptions = {}) {
  const where = executionWhere(options);
  return runPaged(
    options,
    (window) => prisma.testExecution.findMany({ where, orderBy: { createdAt: "desc" }, ...window }),
    () => prisma.testExecution.count({ where })
  );
}

/**
 * An execution covers one or more Approved test cases selected together at planning
 * (`docs/business-rules-and-validation.md:27`). Each covered case becomes one
 * `ExecutionTestCase` row; per-case results arrive only at finalize.
 */
export async function createExecution(
  input: { businessId?: string; testCaseIds: string[]; testerId: string; jiraIssueKey?: string | null },
  actor: Actor
) {
  ensureRole([...RoleSets.canExecute], actor.role);

  // Shape only, and absence is legal — a run need not test a Jira task at all. Verifying the
  // issue exists would let a Jira outage block planning (`src/domain/jira-sync.ts`).
  const jiraIssueKey = normalizeJiraIssueKey(input.jiraIssueKey);

  // `businessId` is optional (`docs/business-rules-and-validation.md:11`): supplied IDs
  // are validated exactly as before; when absent the transaction allocates the next
  // free EXE-#### below.
  const suppliedId = input.businessId?.trim();
  if (input.businessId !== undefined) {
    requireNonBlank(input.businessId, "businessId", "Execution ID cannot be blank.");
    ensureBusinessIdFormat(input.businessId, BUSINESS_ID_PATTERNS.execution, "businessId", "EXE-####");
  }

  if (input.testCaseIds.length === 0) {
    throw new AppError(422, "ID_INVALID", "At least one test case is required.", "testCaseIds");
  }
  if (new Set(input.testCaseIds).size !== input.testCaseIds.length) {
    throw new AppError(422, "ID_INVALID", "Each test case may be selected only once.", "testCaseIds");
  }

  const testCases = await prisma.testCase.findMany({ where: { id: { in: input.testCaseIds } } });
  const caseById = new Map(testCases.map((testCase) => [testCase.id, testCase]));
  for (const [index, testCaseId] of input.testCaseIds.entries()) {
    const testCase = caseById.get(testCaseId);
    if (!testCase) {
      throw new AppError(404, "REFERENCE_NOT_FOUND", "Test case not found.", `testCaseIds[${index}]`);
    }
    if (testCase.lifecycleState !== TestCaseLifecycleState.APPROVED) {
      throw new AppError(422, "FORBIDDEN_TRANSITION", "Execution requires an Approved test case.", `testCaseIds[${index}]`);
    }
  }

  const tester = await prisma.user.findUnique({ where: { id: input.testerId } });
  if (!tester || !tester.active) {
    throw new AppError(422, "REFERENCE_INACTIVE", "Assigned tester is invalid.", "testerId");
  }

  if (suppliedId) {
    const existing = await prisma.testExecution.findUnique({ where: { businessId: suppliedId } });
    if (existing) {
      throw new AppError(409, "ID_DUPLICATE", "Execution ID already exists.", "businessId");
    }
  }

  return prisma.$transaction(async (tx) => {
    const businessId =
      suppliedId ??
      (await allocateBusinessId(tx, "execution", {
        prefix: "EXE-",
        isTaken: async (candidate) =>
          (await tx.testExecution.findUnique({ where: { businessId: candidate }, select: { id: true } })) !== null,
        currentMax: async () =>
          highestSuffix(
            "EXE-",
            (await tx.testExecution.findMany({ select: { businessId: true } })).map((row) => row.businessId)
          )
      }));
    const created = await tx.testExecution.create({
      data: {
        businessId,
        testerId: input.testerId,
        state: ExecutionLifecycleState.PLANNED,
        jiraIssueKey,
        createdBy: actor.userId,
        updatedBy: actor.userId,
        cases: {
          create: input.testCaseIds.map((testCaseId) => ({
            testCaseId,
            createdBy: actor.userId,
            updatedBy: actor.userId
          }))
        }
      },
      include: { cases: true }
    });
    await appendAudit(tx, {
      actorId: actor.userId,
      action: "EXECUTION_CREATED",
      entityType: "Execution",
      entityId: created.id,
      requestId: actor.requestId,
      beforeAfterJson: { after: { ...created, testCaseIds: input.testCaseIds } }
    });
    return created;
  });
}

/**
 * Reassign a Planned execution to a different tester. The same roles that may plan an
 * execution may reassign one (`roles-workflows.md:13` — planning is open to every
 * role), and the tester rule is identical to `createExecution`: the assignee must
 * exist and be active. Once a run leaves Planned its tester is part of the record —
 * reassignment after start would rewrite who did the work, so it is refused.
 */
export async function updateExecution(
  executionId: string,
  input: { testerId: string; version?: number; jiraIssueKey?: string | null },
  actor: Actor
) {
  ensureRole([...RoleSets.canExecute], actor.role);

  const execution = await prisma.testExecution.findUnique({ where: { id: executionId } });
  if (!execution) throw new AppError(404, "REFERENCE_NOT_FOUND", "Execution not found.", "executionId");
  if (execution.state !== ExecutionLifecycleState.PLANNED) {
    throw new AppError(422, "FORBIDDEN_TRANSITION", "Only Planned executions can be reassigned.");
  }
  const expectedVersion = ensureVersion(execution.version, input.version);

  // Only re-point the issue key when the caller actually supplied the field, so a
  // reassignment that says nothing about Jira leaves the key alone. The state check is
  // redundant with the Planned guard above and kept anyway — it is the rule's own home, and
  // it keeps the guarantee true if this function ever accepts a later state.
  const changingIssueKey = input.jiraIssueKey !== undefined;
  if (changingIssueKey) ensureIssueKeyMutable(execution.state);
  const jiraIssueKey = changingIssueKey ? normalizeJiraIssueKey(input.jiraIssueKey) : undefined;

  const tester = await prisma.user.findUnique({ where: { id: input.testerId } });
  if (!tester || !tester.active) {
    throw new AppError(422, "REFERENCE_INACTIVE", "Assigned tester is invalid.", "testerId");
  }

  return withVersionCheck(() => prisma.$transaction(async (tx) => {
    const updated = await tx.testExecution.update({
      where: { id: executionId, version: expectedVersion },
      data: {
        testerId: input.testerId,
        ...(changingIssueKey ? { jiraIssueKey } : {}),
        version: { increment: 1 },
        updatedBy: actor.userId
      }
    });
    // A re-pointed Jira issue is not a reassignment. Auditing both under one action would
    // show an auditor filtering for EXECUTION_REASSIGNED a change that moved no work between
    // people — and hide the issue-key change from anyone looking for it.
    const testerChanged = updated.testerId !== execution.testerId;
    const issueKeyChanged = updated.jiraIssueKey !== execution.jiraIssueKey;

    if (testerChanged || !issueKeyChanged) {
      await appendAudit(tx, {
        actorId: actor.userId,
        action: "EXECUTION_REASSIGNED",
        entityType: "Execution",
        entityId: executionId,
        requestId: actor.requestId,
        beforeAfterJson: {
          before: { testerId: execution.testerId },
          after: { testerId: updated.testerId }
        }
      });
    }

    if (issueKeyChanged) {
      await appendAudit(tx, {
        actorId: actor.userId,
        action: "EXECUTION_JIRA_ISSUE_KEY_CHANGED",
        entityType: "Execution",
        entityId: executionId,
        requestId: actor.requestId,
        beforeAfterJson: {
          before: { jiraIssueKey: execution.jiraIssueKey },
          after: { jiraIssueKey: updated.jiraIssueKey }
        }
      });
    }
    return updated;
  }));
}

function ensureAssignedTester(execution: { testerId: string }, actor: Actor) {
  if (actor.role === QamsRole.QA_TESTER && execution.testerId !== actor.userId) {
    throw new AppError(403, "UNAUTHORIZED", "Assigned tester mismatch.");
  }
}

export async function startExecution(executionId: string, version: number | undefined, actor: Actor) {
  ensureRole([...RoleSets.canExecute], actor.role);
  const execution = await prisma.testExecution.findUnique({ where: { id: executionId } });
  if (!execution) throw new AppError(404, "REFERENCE_NOT_FOUND", "Execution not found.", "executionId");
  if (execution.state !== ExecutionLifecycleState.PLANNED) {
    throw new AppError(422, "FORBIDDEN_TRANSITION", "Only Planned executions can be started.");
  }
  const expectedVersion = ensureVersion(execution.version, version);
  ensureAssignedTester(execution, actor);

  return withVersionCheck(() => prisma.$transaction(async (tx) => {
    const updated = await tx.testExecution.update({
      where: { id: executionId, version: expectedVersion },
      data: {
        state: ExecutionLifecycleState.IN_PROGRESS,
        startedAt: new Date(),
        version: { increment: 1 },
        updatedBy: actor.userId
      }
    });
    await appendAudit(tx, {
      actorId: actor.userId,
      action: "EXECUTION_STARTED",
      entityType: "Execution",
      entityId: executionId,
      requestId: actor.requestId,
      beforeAfterJson: { after: { state: updated.state, startedAt: updated.startedAt } }
    });
    return updated;
  }));
}

type FinalizeCaseResult = {
  testCaseId: string;
  result: ExecutionOutcome;
  actualResult: string;
  blockReason?: string;
  defectId?: string;
  createDefect?: {
    businessId?: string;
    summary: string;
    priority?: string;
    severity?: string;
  };
};

type FinalizeInput = {
  version?: number;
  results: FinalizeCaseResult[];
};

/**
 * The execution-level result derives from the per-case results — Fail if any case
 * failed, else Blocked if any case is blocked, else Pass
 * (`docs/business-rules-and-validation.md:30`).
 */
function deriveExecutionResult(results: FinalizeCaseResult[]): ExecutionOutcome {
  if (results.some((entry) => entry.result === ExecutionOutcome.FAIL)) return ExecutionOutcome.FAIL;
  if (results.some((entry) => entry.result === ExecutionOutcome.BLOCKED)) return ExecutionOutcome.BLOCKED;
  return ExecutionOutcome.PASS;
}

/**
 * All per-case results arrive here, in one request — there is no incremental
 * recording and no partial finalize (`docs/business-rules-and-validation.md:28`).
 * `results` must cover the execution's case set exactly once each; each failing case
 * carries its own defect (an existing `defectId` referencing that specific case, or
 * its own `createDefect`), so one request may create several defects.
 */
export async function finalizeExecution(executionId: string, input: FinalizeInput, actor: Actor) {
  ensureRole([...RoleSets.canExecute], actor.role);

  const execution = await prisma.testExecution.findUnique({
    where: { id: executionId },
    include: { cases: true }
  });
  if (!execution) throw new AppError(404, "REFERENCE_NOT_FOUND", "Execution not found.", "executionId");
  if (execution.state !== ExecutionLifecycleState.IN_PROGRESS) {
    throw new AppError(422, "FORBIDDEN_TRANSITION", "Only In Progress can be finalized.");
  }
  const expectedVersion = ensureVersion(execution.version, input.version);
  ensureAssignedTester(execution, actor);

  // Coverage: every covered case exactly once, nothing extra, nothing missing. This is
  // request validation, so it keeps the 422/ID_INVALID pair `parseWith` and
  // `requireNonBlank` already use (`docs/testing-and-acceptance.md:19`).
  const coveredCaseIds = new Set(execution.cases.map((row) => row.testCaseId));
  const seenCaseIds = new Set<string>();
  for (const [index, entry] of input.results.entries()) {
    if (!coveredCaseIds.has(entry.testCaseId)) {
      throw new AppError(422, "ID_INVALID", "Result supplied for a test case this execution does not cover.", `results[${index}].testCaseId`);
    }
    if (seenCaseIds.has(entry.testCaseId)) {
      throw new AppError(422, "ID_INVALID", "Each covered test case must appear exactly once.", `results[${index}].testCaseId`);
    }
    seenCaseIds.add(entry.testCaseId);
  }
  if (seenCaseIds.size !== coveredCaseIds.size) {
    throw new AppError(422, "ID_INVALID", "Every covered test case requires a result; there is no partial finalize.", "results");
  }

  // Per-case rules, all validated before anything is written.
  const requestDefectIds = new Set<string>();
  for (const [index, entry] of input.results.entries()) {
    const field = (name: string) => `results[${index}].${name}`;
    requireNonBlank(entry.actualResult, field("actualResult"), "Actual result is required for every case.");

    if (entry.result === ExecutionOutcome.BLOCKED) {
      requireNonBlank(entry.blockReason, field("blockReason"), "Block reason is required for a Blocked case.");
    }
    if (entry.result === ExecutionOutcome.FAIL && !entry.defectId && !entry.createDefect) {
      throw new AppError(422, "REFERENCE_NOT_FOUND", "A failing case requires a same-case defect.", field("defectId"));
    }
    if (entry.result === ExecutionOutcome.PASS && entry.createDefect) {
      throw new AppError(422, "FORBIDDEN_TRANSITION", "A passing case must not create a defect.", field("createDefect"));
    }

    if (entry.createDefect) {
      requireNonBlank(entry.createDefect.summary, field("createDefect.summary"), "Defect summary is required.");
      if (entry.createDefect.priority?.trim()) {
        await ensureActiveControlledValue(CATALOGUE_PRIORITY, entry.createDefect.priority.trim(), field("createDefect.priority"));
      }
      if (entry.createDefect.severity?.trim()) {
        await ensureActiveControlledValue(CATALOGUE_SEVERITY, entry.createDefect.severity.trim(), field("createDefect.severity"));
      }
      // `businessId` is optional (`docs/business-rules-and-validation.md:11`): an ID-less
      // entry is allocated in the transaction below — N entries draw N distinct
      // BUG-#### from the one locked counter. A supplied ID is validated exactly as
      // before, and the sibling-duplicate check applies only to supplied IDs.
      const suppliedDefectId = entry.createDefect.businessId?.trim();
      if (entry.createDefect.businessId !== undefined) {
        requireNonBlank(entry.createDefect.businessId, field("createDefect.businessId"), "Defect ID cannot be blank.");
        ensureBusinessIdFormat(entry.createDefect.businessId, BUSINESS_ID_PATTERNS.defect, field("createDefect.businessId"), "BUG-####");
      }
      if (suppliedDefectId) {
        if (requestDefectIds.has(suppliedDefectId)) {
          throw new AppError(409, "ID_DUPLICATE", "Defect ID already used in this request.", field("createDefect.businessId"));
        }
        requestDefectIds.add(suppliedDefectId);
        const existingDefect = await prisma.defect.findUnique({ where: { businessId: suppliedDefectId } });
        if (existingDefect) {
          throw new AppError(409, "ID_DUPLICATE", "Defect ID already exists.", field("createDefect.businessId"));
        }
      }
    }
  }

  const derivedResult = deriveExecutionResult(input.results);

  const finalized = await withVersionCheck(() => prisma.$transaction(async (tx) => {
    const finalizedAt = new Date();

    for (const [index, entry] of input.results.entries()) {
      let linkedDefectId = entry.defectId;

      if (entry.createDefect) {
        const defectBusinessId =
          entry.createDefect.businessId?.trim() ??
          (await allocateBusinessId(tx, "defect", defectIdFormat(tx)));
        const createdDefect = await tx.defect.create({
          data: {
            businessId: defectBusinessId,
            testCaseId: entry.testCaseId,
            summary: entry.createDefect.summary.trim(),
            priority: entry.createDefect.priority?.trim() ?? "",
            severity: entry.createDefect.severity?.trim() ?? "",
            createdBy: actor.userId,
            updatedBy: actor.userId
          }
        });
        linkedDefectId = createdDefect.id;
      }

      if (linkedDefectId) {
        // Looked up by id alone: the defect's own version is irrelevant here — what
        // matters is that it exists and references this entry's test case.
        const defect = await tx.defect.findUnique({ where: { id: linkedDefectId } });
        if (!defect || defect.testCaseId !== entry.testCaseId) {
          throw new AppError(422, "HIERARCHY_MISMATCH", "Defect must reference the same test case.", `results[${index}].defectId`);
        }
        await tx.defectExecutionLink.create({
          data: { defectId: linkedDefectId, executionId, createdBy: actor.userId }
        });
      }

      await tx.executionTestCase.update({
        where: { executionId_testCaseId: { executionId, testCaseId: entry.testCaseId } },
        data: {
          result: entry.result,
          actualResult: entry.actualResult.trim(),
          blockReason: entry.blockReason?.trim(),
          updatedBy: actor.userId
        }
      });

      // One append-only history row per covered case (`docs/data-model.md:26-27`).
      await tx.executionHistory.create({
        data: {
          executionId,
          testCaseId: entry.testCaseId,
          result: entry.result,
          occurredAt: finalizedAt,
          createdBy: actor.userId
        }
      });
    }

    const updated = await tx.testExecution.update({
      where: { id: executionId, version: expectedVersion },
      data: {
        state: ExecutionLifecycleState.FINALIZED,
        result: derivedResult,
        finalizedAt,
        version: { increment: 1 },
        updatedBy: actor.userId
      },
      include: { cases: true }
    });

    await appendAudit(tx, {
      actorId: actor.userId,
      action: "EXECUTION_FINALIZED",
      entityType: "Execution",
      entityId: executionId,
      requestId: actor.requestId,
      beforeAfterJson: {
        after: {
          state: updated.state,
          result: updated.result,
          caseResults: input.results.map((entry) => ({ testCaseId: entry.testCaseId, result: entry.result }))
        }
      }
    });
    return updated;
  }));

  // Deliberately AFTER the transaction has committed. QAMS is the system of record for test
  // results and Jira is a projection of them: no external call may run while a database
  // transaction is open, and an unreachable Jira must never cost a tester their work
  // (`docs/architecture.md#Jira execution sync`, ADR-0003).
  //
  // It IS awaited — a fire-and-forget promise is not safe here, because the server may finish
  // the response and stop executing before it settles. What keeps the tester's request short
  // is the transport's deadline (`JIRA_TRANSITION_TIMEOUT_MS`), not the absence of an await,
  // and `settleJiraSync` never throws.
  await settleJiraSync(finalized, actor);

  return finalized;
}

/**
 * Decide whether finalizing this run completes its Jira issue, and act on it.
 *
 * Never throws. Every failure path here is a Jira problem, and a Jira problem must not
 * surface as a failed finalize — the execution is already committed by the time this runs,
 * and a Finalized execution is immutable, so there is nothing a thrown error could roll back.
 *
 * The decision needs EVERY execution carrying the key, not just this one: several runs share
 * one Jira task, so finalizing this one is necessary but not sufficient
 * (`shouldTransitionIssue`).
 */
async function settleJiraSync(
  execution: { id: string; jiraIssueKey: string | null },
  actor: Actor
): Promise<void> {
  const issueKey = execution.jiraIssueKey;
  if (!issueKey) return;

  try {
    // The transport is the half of this feature that is not built: performing the
    // transition needs the Jira OAuth flow, a stored refresh token and a retry worker
    // (`docs/api-and-security.md#Jira execution sync interface`). Until one is configured
    // there is nothing to attempt, and recording an attempt that never happened would put a
    // lie in an append-only table. Checked first so an unconfigured deployment does no
    // queries at all.
    const transport = getJiraTransport();
    if (!transport) return;

    const siblings = await prisma.testExecution.findMany({
      where: { jiraIssueKey: issueKey },
      select: { state: true, result: true }
    });

    if (!shouldTransitionIssue(siblings)) return;

    /**
     * Transition once per issue, ever.
     *
     * Eligibility is a property of the whole key, not of this run, so it stays true forever
     * once met — a regression re-run planned against the same key and finalized Pass would
     * satisfy it again and fire a second transition. That would silently re-close a ticket a
     * person had deliberately moved back to In Progress.
     *
     * This narrows but does not fully close the concurrent case: two runs for the same key
     * finalizing at the same instant can both read "no success yet". Closing that completely
     * needs a partial unique index on `(jiraIssueKey) WHERE outcome = 'SUCCEEDED'`, which
     * Prisma's schema language cannot express; the duplicate would be a second SUCCEEDED row
     * and a repeat transition Jira treats as a no-op.
     */
    const alreadyTransitioned = await prisma.jiraSyncAttempt.findFirst({
      where: { jiraIssueKey: issueKey, outcome: JiraSyncOutcome.SUCCEEDED },
      select: { id: true }
    });
    if (alreadyTransitioned) return;

    // A transport that REJECTS is the normal shape of a network failure, and it must be
    // recorded exactly like one that resolves `FAILED` — otherwise the QA Lead failure list
    // this feature exists to feed stays empty precisely when Jira is down.
    let result: JiraTransitionResult;
    try {
      result = await transport.transitionToDone({
        issueKey,
        executionId: execution.id,
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

    // The attempt row and its audit event are written together: `docs/api-and-security.md`
    // requires every sync attempt to be audited, and a row without an event would leave a
    // Jira transition with no trace in the append-only log.
    await prisma.$transaction(async (tx) => {
      const attempt = await tx.jiraSyncAttempt.create({
        data: {
          executionId: execution.id,
          jiraIssueKey: issueKey,
          outcome: result.outcome,
          // Sanitized on the resolved path too, not only the thrown one: a transport that
          // reports its own failure is quoting the same third-party client.
          failureReason: result.failureReason ? sanitizeFailureReason(result.failureReason) : null,
          actorId: result.actorId ?? null
        }
      });
      await appendAudit(tx, {
        actorId: actor.userId,
        action: "JIRA_SYNC_ATTEMPTED",
        entityType: "Execution",
        entityId: execution.id,
        requestId: actor.requestId,
        beforeAfterJson: {
          after: {
            jiraIssueKey: issueKey,
            outcome: attempt.outcome,
            failureReason: attempt.failureReason,
            // Null means the service-account fallback performed the write rather than a
            // person; this event is then the only record of who caused it.
            performedByUserId: attempt.actorId
          }
        }
      });
    });
  } catch (error) {
    // This function cannot fail a finalize: the execution is already committed and is
    // immutable, so there is nothing a thrown error could undo. It must still be visible —
    // a silent failure here is how QAMS and Jira drift apart unobserved. Logged, never
    // rethrown.
    logRequest({
      occurredAt: new Date().toISOString(),
      requestId: actor.requestId,
      status: 500,
      actorId: actor.userId,
      action: "JIRA_SYNC_FAILED",
      message: `Jira sync could not be settled for ${issueKey}: ${failureReasonOf(error)}`
    });
  }
}

/**
 * A short description of a thrown value, with credential material stripped.
 *
 * The message originates in a third-party HTTP client and is stored in an append-only table
 * and an audit event, both of which are kept forever and read by a QA Lead — so it is
 * sanitized rather than trusted (`sanitizeFailureReason`).
 */
function failureReasonOf(error: unknown): string {
  if (error instanceof Error) return sanitizeFailureReason(error.message);
  return "Unknown transport failure.";
}

export async function executionHistory(executionId: string) {
  return prisma.executionHistory.findMany({
    where: { executionId },
    orderBy: { occurredAt: "asc" }
  });
}

/**
 * Reads for the web interface. Added for the UI vertical slice so screens never
 * reach for Prisma directly - `docs/architecture.md:33` keeps data access behind
 * the domain layer regardless of which caller is asking.
 *
 * Neither selects `passwordHash`; `docs/data-model.md:35` forbids returning it, and
 * the API already leaks it once (audit section 2.2). Select tester fields explicitly so
 * this cannot become the second place.
 */
const TESTER_SELECT = { id: true, displayName: true, email: true } as const;

const TEST_CASE_SELECT = {
  id: true,
  businessId: true,
  title: true,
  lifecycleState: true,
  priority: true,
  severity: true
} as const;

/** The covered cases with their per-case outcome fields and the case context screens show. */
const CASES_INCLUDE = {
  orderBy: { createdAt: "asc" as const },
  include: { testCase: { select: TEST_CASE_SELECT } }
} as const;

/** The executions record screen: one page of runs with covered cases and tester context. */
export async function listExecutionsWithCase(options: ExecutionListOptions = {}) {
  const where = executionWhere(options);
  return runPaged(
    options,
    (window) =>
      prisma.testExecution.findMany({
        where,
        include: {
          cases: CASES_INCLUDE,
          tester: { select: TESTER_SELECT }
        },
        orderBy: { createdAt: "desc" },
        ...window
      }),
    () => prisma.testExecution.count({ where })
  );
}

/**
 * The people an execution can be assigned to. Any authenticated role may plan an
 * execution (`roles-workflows.md:13`), so this is not QA-Lead-gated like
 * `listUsers` — and it exposes only the same three fields every execution row
 * already shows for its tester.
 */
export async function listAssignableTesters() {
  return prisma.user.findMany({
    where: { active: true },
    select: TESTER_SELECT,
    orderBy: { displayName: "asc" }
  });
}

/** Unfinished runs assigned to one person — powers the My work badge in the navigation. */
export async function openAssignedExecutionCount(testerId: string) {
  return prisma.testExecution.count({
    where: { testerId, state: { not: ExecutionLifecycleState.FINALIZED } }
  });
}

/**
 * Open runs per tester, as a `testerId -> count` map.
 *
 * The planner picks who runs a set of cases, and offering a bare list of names makes
 * that a guess: the person choosing has no way to see that one tester already has nine
 * unfinished runs and another has none. This is the same count the My work badge shows
 * (`openAssignedExecutionCount`), for everyone at once rather than one query per name.
 *
 * A `groupBy` returns only testers who HAVE open runs, so callers must read a missing
 * key as zero — which is why this returns a map rather than rows.
 */
export async function openExecutionCountsByTester(): Promise<Map<string, number>> {
  const rows = await prisma.testExecution.groupBy({
    by: ["testerId"],
    where: { state: { not: ExecutionLifecycleState.FINALIZED } },
    _count: { _all: true }
  });
  return new Map(rows.map((row) => [row.testerId, row._count._all]));
}

/**
 * The tally behind the My work tabs: how many of a tester's runs sit in each state.
 *
 * One `groupBy` rather than a count per tab, and it takes the same filters the list
 * takes — needle, product, feature — so a narrowed queue's tabs report the narrowed
 * numbers. A tab counting something the tab cannot show is worse than no count at all.
 * Counting is not new capability: it is the same `where` the list itself runs, narrowed
 * to one tester.
 */
export type AssignedWorkCounts = {
  planned: number;
  inProgress: number;
  /** Planned + In Progress — the unfinished queue, and the "All" tab's number. */
  open: number;
  finalized: number;
};

export async function assignedWorkCounts(
  testerId: string,
  options: Pick<ExecutionListOptions, "query" | "productId" | "featureId"> = {}
): Promise<AssignedWorkCounts> {
  const rows = await prisma.testExecution.groupBy({
    by: ["state"],
    where: executionWhere({ ...options, testerId }),
    _count: { _all: true }
  });
  // A groupBy returns only states that HAVE rows, so a missing key is zero.
  const countOf = (state: ExecutionLifecycleState) =>
    rows.find((row) => row.state === state)?._count._all ?? 0;
  const planned = countOf(ExecutionLifecycleState.PLANNED);
  const inProgress = countOf(ExecutionLifecycleState.IN_PROGRESS);
  return {
    planned,
    inProgress,
    open: planned + inProgress,
    finalized: countOf(ExecutionLifecycleState.FINALIZED)
  };
}

/**
 * A tester's work queue, one page at a time.
 *
 * ## Why the in-memory sort had to go
 *
 * This used to fetch every run assigned to the tester and `sort()` them into
 * In Progress -> Planned -> Finalized. That cannot survive paging: sorting a page sorts
 * only the rows already chosen, so row 51 would be ordered against the wrong set.
 *
 * The ordering is now SQL, and it still is not the enum's storage order being relied on
 * by accident. The screen asks for the two groups separately — the open queue
 * (`states: [PLANNED, IN_PROGRESS]`) and finalized runs — so within the open queue the
 * only choice left is In Progress before Planned, which `state: "desc"` gives against
 * the declared enum order (PLANNED, IN_PROGRESS, FINALIZED). Still a presentation
 * choice, per audit section 5.4: the knowledge base enumerates no sort policy for
 * collections, so this is the screen's decision, not a rule.
 */
export async function listExecutionsForTester(
  testerId: string,
  options: ExecutionListOptions = {}
) {
  const where = executionWhere({ ...options, testerId });
  return runPaged(
    options,
    (window) =>
      prisma.testExecution.findMany({
        where,
        include: { cases: CASES_INCLUDE },
        orderBy: [{ state: "desc" }, { createdAt: "desc" }],
        ...window
      }),
    () => prisma.testExecution.count({ where })
  );
}

export async function executionDetail(executionId: string) {
  return prisma.testExecution.findUnique({
    where: { id: executionId },
    include: {
      cases: {
        orderBy: { createdAt: "asc" as const },
        include: {
          testCase: {
            select: { ...TEST_CASE_SELECT, steps: { orderBy: { sequence: "asc" as const } } }
          }
        }
      },
      tester: { select: TESTER_SELECT },
      history: { orderBy: { occurredAt: "asc" as const } }
    }
  });
}
