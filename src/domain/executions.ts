import { ExecutionLifecycleState, ExecutionOutcome, QamsRole, TestCaseLifecycleState } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { ensureRole, RoleSets } from "@/lib/rbac";
import { ensureVersion, requireNonBlank } from "@/lib/validation";
import { BUSINESS_ID_PATTERNS, ensureBusinessIdFormat } from "@/lib/business-ids";
import { ensureActiveControlledValue } from "@/lib/controlled-values";
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

function ensureAssignedTester(execution: { testerId: string }, actor: Actor) {
  if (actor.role === QamsRole.QA_TESTER && execution.testerId !== actor.userId) {
    throw new AppError(403, "UNAUTHORIZED", "Assigned tester mismatch.");
  }
}

export async function startExecution(executionId: string, version: number, actor: Actor) {
  ensureRole([...RoleSets.canExecute], actor.role);
  const execution = await prisma.testExecution.findUnique({ where: { id: executionId } });
  if (!execution) throw new AppError(404, "REFERENCE_NOT_FOUND", "Execution not found.", "executionId");
  if (execution.state !== ExecutionLifecycleState.PLANNED) {
    throw new AppError(422, "FORBIDDEN_TRANSITION", "Only Planned executions can be started.");
  }
  ensureVersion(execution.version, version);
  ensureAssignedTester(execution, actor);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.testExecution.update({
      where: { id: executionId },
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
  });
}

type FinalizeInput = {
  version: number;
  result: ExecutionOutcome;
  actualResult: string;
  blockReason?: string;
  defectId?: string;
  createDefect?: {
    businessId: string;
    summary: string;
    priority: string;
    severity: string;
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
  ensureVersion(execution.version, input.version);
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
      await ensureActiveControlledValue("Priority", input.createDefect.priority.trim(), "createDefect.priority");
    }
    if (input.createDefect.severity?.trim()) {
      await ensureActiveControlledValue("Severity", input.createDefect.severity.trim(), "createDefect.severity");
    }
    const existingDefect = await prisma.defect.findUnique({ where: { businessId: input.createDefect.businessId } });
    if (existingDefect) {
      throw new AppError(409, "ID_DUPLICATE", "Defect ID already exists.", "createDefect.businessId");
    }
  }

  return prisma.$transaction(async (tx) => {
    let linkedDefectId = input.defectId;

    if (input.createDefect) {
      const createdDefect = await tx.defect.create({
        data: {
          businessId: input.createDefect.businessId.trim(),
          testCaseId: execution.testCaseId,
          summary: input.createDefect.summary.trim(),
          priority: input.createDefect.priority.trim(),
          severity: input.createDefect.severity.trim(),
          createdBy: actor.userId,
          updatedBy: actor.userId
        }
      });
      linkedDefectId = createdDefect.id;
    }

    if (linkedDefectId) {
      const defect = await tx.defect.findUnique({ where: { id: linkedDefectId } });
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
  });
}

export async function executionHistory(executionId: string) {
  return prisma.executionHistory.findMany({
    where: { executionId },
    orderBy: { occurredAt: "asc" }
  });
}
