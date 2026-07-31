import { ExecutionLifecycleState, ExecutionOutcome, QamsRole, TestCaseLifecycleState } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { ensureRole, RoleSets } from "@/lib/rbac";
import { ensureVersion, requireNonBlank } from "@/lib/validation";
import { withVersionCheck } from "@/lib/optimistic-lock";
import { BUSINESS_ID_PATTERNS, ensureBusinessIdFormat } from "@/lib/business-ids";
import { ensureActiveControlledValue } from "@/lib/controlled-values";
import { CATALOGUE_PRIORITY, CATALOGUE_SEVERITY } from "@/lib/controlled-value-catalogues";
import { appendAudit } from "@/lib/audit";

type Actor = { userId: string; role: QamsRole; requestId: string };

export async function listExecutions() {
  return prisma.testExecution.findMany({ orderBy: { createdAt: "desc" } });
}

export async function createExecution(
  input: { businessId: string; testCaseId: string; testerId: string },
  actor: Actor
) {
  ensureRole([...RoleSets.canExecute], actor.role);
  requireNonBlank(input.businessId, "businessId", "Execution ID is required.");
  ensureBusinessIdFormat(input.businessId, BUSINESS_ID_PATTERNS.execution, "businessId", "EXE-####");

  const testCase = await prisma.testCase.findUnique({ where: { id: input.testCaseId } });
  if (!testCase) throw new AppError(404, "REFERENCE_NOT_FOUND", "Test case not found.", "testCaseId");
  if (testCase.lifecycleState !== TestCaseLifecycleState.APPROVED) {
    throw new AppError(422, "FORBIDDEN_TRANSITION", "Execution requires an Approved test case.", "testCaseId");
  }

  const tester = await prisma.user.findUnique({ where: { id: input.testerId } });
  if (!tester || !tester.active) {
    throw new AppError(422, "REFERENCE_INACTIVE", "Assigned tester is invalid.", "testerId");
  }

  const existing = await prisma.testExecution.findUnique({ where: { businessId: input.businessId } });
  if (existing) {
    throw new AppError(409, "ID_DUPLICATE", "Execution ID already exists.", "businessId");
  }

  return prisma.$transaction(async (tx) => {
    const created = await tx.testExecution.create({
      data: {
        businessId: input.businessId.trim(),
        testCaseId: input.testCaseId,
        testerId: input.testerId,
        state: ExecutionLifecycleState.PLANNED,
        createdBy: actor.userId,
        updatedBy: actor.userId
      }
    });
    await appendAudit(tx, {
      actorId: actor.userId,
      action: "EXECUTION_CREATED",
      entityType: "Execution",
      entityId: created.id,
      requestId: actor.requestId,
      beforeAfterJson: { after: created }
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
  input: { testerId: string; version?: number },
  actor: Actor
) {
  ensureRole([...RoleSets.canExecute], actor.role);

  const execution = await prisma.testExecution.findUnique({ where: { id: executionId } });
  if (!execution) throw new AppError(404, "REFERENCE_NOT_FOUND", "Execution not found.", "executionId");
  if (execution.state !== ExecutionLifecycleState.PLANNED) {
    throw new AppError(422, "FORBIDDEN_TRANSITION", "Only Planned executions can be reassigned.");
  }
  const expectedVersion = ensureVersion(execution.version, input.version);

  const tester = await prisma.user.findUnique({ where: { id: input.testerId } });
  if (!tester || !tester.active) {
    throw new AppError(422, "REFERENCE_INACTIVE", "Assigned tester is invalid.", "testerId");
  }

  return withVersionCheck(() => prisma.$transaction(async (tx) => {
    const updated = await tx.testExecution.update({
      where: { id: executionId, version: expectedVersion },
      data: { testerId: input.testerId, version: { increment: 1 }, updatedBy: actor.userId }
    });
    await appendAudit(tx, {
      actorId: actor.userId,
      action: "EXECUTION_REASSIGNED",
      entityType: "Execution",
      entityId: executionId,
      requestId: actor.requestId,
      beforeAfterJson: { before: { testerId: execution.testerId }, after: { testerId: updated.testerId } }
    });
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

type FinalizeInput = {
  version?: number;
  result: ExecutionOutcome;
  actualResult: string;
  blockReason?: string;
  defectId?: string;
  createDefect?: {
    businessId: string;
    summary: string;
    priority?: string;
    severity?: string;
  };
};

export async function finalizeExecution(executionId: string, input: FinalizeInput, actor: Actor) {
  ensureRole([...RoleSets.canExecute], actor.role);
  requireNonBlank(input.actualResult, "actualResult", "Actual result is required.");

  const execution = await prisma.testExecution.findUnique({ where: { id: executionId } });
  if (!execution) throw new AppError(404, "REFERENCE_NOT_FOUND", "Execution not found.", "executionId");
  if (execution.state !== ExecutionLifecycleState.IN_PROGRESS) {
    throw new AppError(422, "FORBIDDEN_TRANSITION", "Only In Progress can be finalized.");
  }
  const expectedVersion = ensureVersion(execution.version, input.version);
  ensureAssignedTester(execution, actor);

  if (input.result === ExecutionOutcome.BLOCKED) {
    requireNonBlank(input.blockReason, "blockReason", "Block reason is required for Blocked result.");
  }
  if (input.result === ExecutionOutcome.FAIL && !input.defectId && !input.createDefect) {
    throw new AppError(422, "REFERENCE_NOT_FOUND", "Fail requires a same-case defect.", "defectId");
  }
  if (input.result === ExecutionOutcome.PASS && input.createDefect) {
    throw new AppError(422, "FORBIDDEN_TRANSITION", "Pass must not create a new defect.");
  }

  if (input.createDefect) {
    requireNonBlank(input.createDefect.businessId, "createDefect.businessId", "Defect ID is required.");
    requireNonBlank(input.createDefect.summary, "createDefect.summary", "Defect summary is required.");
    ensureBusinessIdFormat(input.createDefect.businessId, BUSINESS_ID_PATTERNS.defect, "createDefect.businessId", "BUG-####");
    if (input.createDefect.priority?.trim()) {
      await ensureActiveControlledValue(CATALOGUE_PRIORITY, input.createDefect.priority.trim(), "createDefect.priority");
    }
    if (input.createDefect.severity?.trim()) {
      await ensureActiveControlledValue(CATALOGUE_SEVERITY, input.createDefect.severity.trim(), "createDefect.severity");
    }
    const existingDefect = await prisma.defect.findUnique({ where: { businessId: input.createDefect.businessId } });
    if (existingDefect) {
      throw new AppError(409, "ID_DUPLICATE", "Defect ID already exists.", "createDefect.businessId");
    }
  }

  return withVersionCheck(() => prisma.$transaction(async (tx) => {
    let linkedDefectId = input.defectId;

    if (input.createDefect) {
      const createdDefect = await tx.defect.create({
        data: {
          businessId: input.createDefect.businessId.trim(),
          testCaseId: execution.testCaseId,
          summary: input.createDefect.summary.trim(),
          priority: input.createDefect.priority?.trim() ?? "",
          severity: input.createDefect.severity?.trim() ?? "",
          createdBy: actor.userId,
          updatedBy: actor.userId
        }
      });
      linkedDefectId = createdDefect.id;
    }

    if (linkedDefectId) {
      const defect = await tx.defect.findUnique({ where: { id: linkedDefectId, version: expectedVersion } });
      if (!defect || defect.testCaseId !== execution.testCaseId) {
        throw new AppError(422, "HIERARCHY_MISMATCH", "Defect must reference the same test case.", "defectId");
      }
      await tx.defectExecutionLink.create({
        data: { defectId: linkedDefectId, executionId, createdBy: actor.userId }
      });
    }

    const updated = await tx.testExecution.update({
      where: { id: executionId },
      data: {
        state: ExecutionLifecycleState.FINALIZED,
        result: input.result,
        actualResult: input.actualResult.trim(),
        blockReason: input.blockReason?.trim(),
        finalizedAt: new Date(),
        version: { increment: 1 },
        updatedBy: actor.userId
      }
    });

    await tx.executionHistory.create({
      data: {
        executionId,
        testCaseId: execution.testCaseId,
        result: input.result,
        occurredAt: new Date(),
        createdBy: actor.userId
      }
    });

    await appendAudit(tx, {
      actorId: actor.userId,
      action: "EXECUTION_FINALIZED",
      entityType: "Execution",
      entityId: executionId,
      requestId: actor.requestId,
      beforeAfterJson: { after: { state: updated.state, result: updated.result } }
    });
    return updated;
  }));
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

/** The executions record screen: every run with its case and tester context. */
export async function listExecutionsWithCase() {
  return prisma.testExecution.findMany({
    include: {
      testCase: { select: TEST_CASE_SELECT },
      tester: { select: TESTER_SELECT }
    },
    orderBy: { createdAt: "desc" }
  });
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

/** A tester's work queue: everything assigned to them, unfinished work first. */
export async function listExecutionsForTester(testerId: string) {
  const rows = await prisma.testExecution.findMany({
    where: { testerId },
    include: { testCase: { select: TEST_CASE_SELECT } },
    orderBy: { createdAt: "desc" }
  });

  // Sort in memory rather than in SQL: the documented lifecycle order
  // (Planned -> In Progress -> Finalized) is not the enum's storage order, and the
  // knowledge base defines no sort policy for collections (audit section 5.4 - the
  // "documented fields" for sorting are never enumerated). Kept out of the query so
  // it is visibly a presentation choice, not an invented rule.
  const order: Record<ExecutionLifecycleState, number> = {
    IN_PROGRESS: 0,
    PLANNED: 1,
    FINALIZED: 2
  };
  return rows.sort((a, b) => order[a.state] - order[b.state]);
}

export async function executionDetail(executionId: string) {
  return prisma.testExecution.findUnique({
    where: { id: executionId },
    include: {
      testCase: {
        select: { ...TEST_CASE_SELECT, steps: { orderBy: { sequence: "asc" as const } } }
      },
      tester: { select: TESTER_SELECT },
      history: { orderBy: { occurredAt: "asc" as const } }
    }
  });
}
