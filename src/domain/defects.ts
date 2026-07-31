import { DefectLifecycleState, QamsRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { ensureRole, RoleSets } from "@/lib/rbac";
import { ensureVersion, requireNonBlank, requireNonBlankIfProvided } from "@/lib/validation";
import { withVersionCheck } from "@/lib/optimistic-lock";
import { BUSINESS_ID_PATTERNS, ensureBusinessIdFormat } from "@/lib/business-ids";
import { ensureActiveControlledValue } from "@/lib/controlled-values";
import { CATALOGUE_PRIORITY, CATALOGUE_SEVERITY } from "@/lib/controlled-value-catalogues";
import { appendAudit } from "@/lib/audit";

type Actor = { userId: string; role: QamsRole; requestId: string };

export async function listDefects() {
  return prisma.defect.findMany({ orderBy: { createdAt: "desc" } });
}

export async function getDefect(id: string) {
  const row = await prisma.defect.findUnique({ where: { id } });
  if (!row) throw new AppError(404, "REFERENCE_NOT_FOUND", "Defect not found.", "id");
  return row;
}

// Reads for the web interface, so screens never reach for Prisma directly
// (`docs/architecture.md:33`). Explicit selects on the joined test case; nothing here
// can widen what a defect row already shows.
const DEFECT_CASE_SELECT = { id: true, businessId: true, title: true } as const;

export async function listDefectsWithCase() {
  return prisma.defect.findMany({
    include: { testCase: { select: DEFECT_CASE_SELECT } },
    orderBy: { createdAt: "desc" }
  });
}

export async function defectDetail(id: string) {
  return prisma.defect.findUnique({
    where: { id },
    include: { testCase: { select: DEFECT_CASE_SELECT } }
  });
}

export async function createDefect(
  input: { businessId: string; testCaseId: string; summary: string; priority?: string; severity?: string },
  actor: Actor
) {
  ensureRole([...RoleSets.canExecute], actor.role);
  requireNonBlank(input.businessId, "businessId", "Defect ID is required.");
  requireNonBlank(input.summary, "summary", "Summary is required.");
  ensureBusinessIdFormat(input.businessId, BUSINESS_ID_PATTERNS.defect, "businessId", "BUG-####");

  const testCase = await prisma.testCase.findUnique({ where: { id: input.testCaseId } });
  if (!testCase) throw new AppError(404, "REFERENCE_NOT_FOUND", "Test case not found.", "testCaseId");

  if (input.priority?.trim()) await ensureActiveControlledValue(CATALOGUE_PRIORITY, input.priority.trim(), "priority");
  if (input.severity?.trim()) await ensureActiveControlledValue(CATALOGUE_SEVERITY, input.severity.trim(), "severity");

  const existing = await prisma.defect.findUnique({ where: { businessId: input.businessId } });
  if (existing) {
    throw new AppError(409, "ID_DUPLICATE", "Defect ID already exists.", "businessId");
  }

  return prisma.$transaction(async (tx) => {
    const created = await tx.defect.create({
      data: {
        businessId: input.businessId.trim(),
        testCaseId: input.testCaseId,
        summary: input.summary.trim(),
        priority: input.priority?.trim() ?? "",
        severity: input.severity?.trim() ?? "",
        createdBy: actor.userId,
        updatedBy: actor.userId
      }
    });
    await appendAudit(tx, {
      actorId: actor.userId,
      action: "DEFECT_CREATED",
      entityType: "Defect",
      entityId: created.id,
      requestId: actor.requestId,
      beforeAfterJson: { after: created }
    });
    return created;
  });
}

export async function updateDefectDetails(
  defectId: string,
  input: { summary?: string; priority?: string; severity?: string; version?: number },
  actor: Actor
) {
  ensureRole([...RoleSets.canExecute], actor.role);
  requireNonBlankIfProvided(input.summary, "summary", "Summary cannot be blank.");

  const current = await prisma.defect.findUnique({ where: { id: defectId } });
  if (!current) throw new AppError(404, "REFERENCE_NOT_FOUND", "Defect not found.", "defectId");
  if (current.status !== DefectLifecycleState.NEW) {
    throw new AppError(422, "FORBIDDEN_TRANSITION", "Only a New defect can have its details edited.");
  }
  const expectedVersion = ensureVersion(current.version, input.version);

  if (input.priority?.trim()) await ensureActiveControlledValue(CATALOGUE_PRIORITY, input.priority.trim(), "priority");
  if (input.severity?.trim()) await ensureActiveControlledValue(CATALOGUE_SEVERITY, input.severity.trim(), "severity");

  return withVersionCheck(() => prisma.$transaction(async (tx) => {
    const updated = await tx.defect.update({
      where: { id: defectId, version: expectedVersion },
      data: {
        summary: input.summary?.trim() ?? current.summary,
        priority: input.priority?.trim() ?? current.priority,
        severity: input.severity?.trim() ?? current.severity,
        version: { increment: 1 },
        updatedBy: actor.userId
      }
    });
    await appendAudit(tx, {
      actorId: actor.userId,
      action: "DEFECT_UPDATED",
      entityType: "Defect",
      entityId: defectId,
      requestId: actor.requestId,
      beforeAfterJson: { before: current, after: updated }
    });
    return updated;
  }));
}

const defectTransitions: Record<DefectLifecycleState, DefectLifecycleState[]> = {
  NEW: [DefectLifecycleState.TRIAGED],
  TRIAGED: [DefectLifecycleState.IN_PROGRESS],
  IN_PROGRESS: [DefectLifecycleState.RESOLVED],
  RESOLVED: [DefectLifecycleState.CLOSED, DefectLifecycleState.IN_PROGRESS],
  CLOSED: []
};

export async function transitionDefect(
  defectId: string,
  input: {
    version?: number;
    targetStatus: DefectLifecycleState;
    investigationOwnerId?: string;
    resolutionSummary?: string;
    retestEvidenceRef?: string;
    closureRationale?: string;
    reopenReason?: string;
  },
  actor: Actor
) {
  ensureRole([...RoleSets.canExecute], actor.role);

  const defect = await prisma.defect.findUnique({ where: { id: defectId } });
  if (!defect) throw new AppError(404, "REFERENCE_NOT_FOUND", "Defect not found.", "defectId");
  const expectedVersion = ensureVersion(defect.version, input.version);

  if (!defectTransitions[defect.status].includes(input.targetStatus)) {
    throw new AppError(422, "FORBIDDEN_TRANSITION", "Invalid defect transition.");
  }

  if (input.targetStatus === DefectLifecycleState.TRIAGED) {
    ensureRole([...RoleSets.canTriageDefect], actor.role);
    requireNonBlank(defect.priority, "priority", "Priority is required before triage.");
    requireNonBlank(defect.severity, "severity", "Severity is required before triage.");
    await ensureActiveControlledValue(CATALOGUE_PRIORITY, defect.priority, "priority");
    await ensureActiveControlledValue(CATALOGUE_SEVERITY, defect.severity, "severity");
  }

  const statesRequiringAdvanceRole: DefectLifecycleState[] = [
    DefectLifecycleState.IN_PROGRESS,
    DefectLifecycleState.RESOLVED,
    DefectLifecycleState.CLOSED
  ];
  if (statesRequiringAdvanceRole.includes(input.targetStatus)) {
    ensureRole([...RoleSets.canAdvanceDefect], actor.role);
  }

  if (input.targetStatus === DefectLifecycleState.IN_PROGRESS && defect.status === DefectLifecycleState.TRIAGED) {
    requireNonBlank(
      input.investigationOwnerId,
      "investigationOwnerId",
      "Investigation owner is required to move to In Progress."
    );
  }

  if (input.targetStatus === DefectLifecycleState.RESOLVED) {
    requireNonBlank(input.resolutionSummary, "resolutionSummary", "Resolution summary is required.");
  }

  if (input.targetStatus === DefectLifecycleState.CLOSED) {
    if (!input.retestEvidenceRef?.trim() && !input.closureRationale?.trim()) {
      throw new AppError(
        422,
        "ID_INVALID",
        "Closure requires retest evidence reference or closure rationale."
      );
    }
  }

  if (input.targetStatus === DefectLifecycleState.IN_PROGRESS && defect.status === DefectLifecycleState.RESOLVED) {
    requireNonBlank(input.reopenReason, "reopenReason", "Reopen reason is required.");
  }

  return withVersionCheck(() => prisma.$transaction(async (tx) => {
    const updated = await tx.defect.update({
      where: { id: defectId, version: expectedVersion },
      data: {
        status: input.targetStatus,
        investigationOwnerId: input.investigationOwnerId ?? defect.investigationOwnerId,
        resolutionSummary: input.resolutionSummary ?? defect.resolutionSummary,
        retestEvidenceRef: input.retestEvidenceRef ?? defect.retestEvidenceRef,
        closureRationale: input.closureRationale ?? defect.closureRationale,
        version: { increment: 1 },
        updatedBy: actor.userId
      }
    });
    // The transition rationales belong in the event, not only on the record.
    // roles-workflows.md:49 requires the reopen reason be *recorded*, and it has no
    // column — this payload is the only place it survives at all. The other three
    // do reach columns, but business-rules-and-validation.md:50 asks the audit event
    // for a before/after summary, and a transition's "why" is the heart of that.
    await appendAudit(tx, {
      actorId: actor.userId,
      action: "DEFECT_TRANSITIONED",
      entityType: "Defect",
      entityId: defectId,
      requestId: actor.requestId,
      beforeAfterJson: {
        before: { status: defect.status },
        after: {
          status: updated.status,
          ...(input.investigationOwnerId?.trim() && { investigationOwnerId: input.investigationOwnerId.trim() }),
          ...(input.resolutionSummary?.trim() && { resolutionSummary: input.resolutionSummary.trim() }),
          ...(input.retestEvidenceRef?.trim() && { retestEvidenceRef: input.retestEvidenceRef.trim() }),
          ...(input.closureRationale?.trim() && { closureRationale: input.closureRationale.trim() }),
          ...(input.reopenReason?.trim() && { reopenReason: input.reopenReason.trim() })
        }
      }
    });
    return updated;
  }));
}
