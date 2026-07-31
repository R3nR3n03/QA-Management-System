import { Prisma, QamsRole, TestCaseLifecycleState } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { ensureRole, RoleSets } from "@/lib/rbac";
import { ensureStepSequence, ensureVersion, requireNonBlank, requireNonBlankIfProvided } from "@/lib/validation";
import { BUSINESS_ID_PATTERNS, ensureBusinessIdFormat } from "@/lib/business-ids";
import { ensureActiveControlledValue } from "@/lib/controlled-values";
import { CATALOGUE_PRIORITY, CATALOGUE_SEVERITY } from "@/lib/controlled-value-catalogues";
import { appendAudit } from "@/lib/audit";

type Actor = { userId: string; role: QamsRole; requestId: string };

export type CreateTestCaseInput = {
  businessId: string;
  productId: string;
  moduleId: string;
  featureId: string;
  requirementId: string;
  cycle: string;
  sprint: string;
  release: string;
  environment: string;
  priority: string;
  severity: string;
  title: string;
  objective: string;
  expectedResult: string;
  revisesTestCaseId?: string;
};

export async function listTestCases() {
  return prisma.testCase.findMany({
    include: { steps: { orderBy: { sequence: "asc" } } },
    orderBy: { businessId: "asc" }
  });
}

async function validateHierarchy(productId: string, moduleId: string, featureId: string, requirementId: string) {
  const requirement = await prisma.requirement.findUnique({
    where: { id: requirementId },
    include: { feature: { include: { module: true } } }
  });
  if (!requirement) {
    throw new AppError(404, "REFERENCE_NOT_FOUND", "Requirement was not found.", "requirementId");
  }
  if (
    requirement.feature.id !== featureId ||
    requirement.feature.module.id !== moduleId ||
    requirement.feature.module.productId !== productId
  ) {
    throw new AppError(
      422,
      "HIERARCHY_MISMATCH",
      "The requirement does not belong to the supplied feature.",
      "requirementId"
    );
  }
}

/**
 * Builds the Prisma create payload for a test case from an explicit allow-list.
 *
 * Never spread the request body into a Prisma payload: `lifecycleState`, `version`,
 * `reviewReason` and `retirementReason` are server-controlled and a caller that supplies
 * them must not be able to reach the database with them. Only the fields enumerated here
 * are writable on create; `lifecycleState` is always forced to DRAFT so the
 * DRAFT -> IN_REVIEW -> APPROVED lifecycle (and its audit events) cannot be bypassed.
 *
 * The `Prisma.TestCaseUncheckedCreateInput` return type is the compile-time guard: any
 * stray key added here later is a type error.
 */
export function buildTestCaseCreateData(
  input: CreateTestCaseInput,
  actor: Pick<Actor, "userId">
): Prisma.TestCaseUncheckedCreateInput {
  return {
    businessId: input.businessId.trim(),
    productId: input.productId,
    moduleId: input.moduleId,
    featureId: input.featureId,
    requirementId: input.requirementId,
    cycle: input.cycle.trim(),
    sprint: input.sprint.trim(),
    release: input.release.trim(),
    environment: input.environment.trim(),
    priority: input.priority.trim(),
    severity: input.severity.trim(),
    title: input.title.trim(),
    objective: input.objective.trim(),
    expectedResult: input.expectedResult.trim(),
    revisesTestCaseId: input.revisesTestCaseId ?? undefined,
    lifecycleState: TestCaseLifecycleState.DRAFT,
    authorUserId: actor.userId,
    createdBy: actor.userId,
    updatedBy: actor.userId
  };
}

export async function createTestCase(input: CreateTestCaseInput, actor: Actor) {
  ensureRole([...RoleSets.canAuthor], actor.role);
  requireNonBlank(input.businessId, "businessId", "Test case ID is required.");
  requireNonBlank(input.title, "title", "Title is required.");
  requireNonBlank(input.objective, "objective", "Objective is required.");
  requireNonBlank(input.expectedResult, "expectedResult", "Expected result is required.");
  ensureBusinessIdFormat(input.businessId, BUSINESS_ID_PATTERNS.testCase, "businessId", "TC-<PRODUCT>-####");

  await validateHierarchy(input.productId, input.moduleId, input.featureId, input.requirementId);

  if (input.priority?.trim()) await ensureActiveControlledValue(CATALOGUE_PRIORITY, input.priority.trim(), "priority");
  if (input.severity?.trim()) await ensureActiveControlledValue(CATALOGUE_SEVERITY, input.severity.trim(), "severity");

  if (input.revisesTestCaseId) {
    const priorCase = await prisma.testCase.findUnique({ where: { id: input.revisesTestCaseId } });
    if (!priorCase) {
      throw new AppError(404, "REFERENCE_NOT_FOUND", "Revised test case not found.", "revisesTestCaseId");
    }
    if (priorCase.lifecycleState !== TestCaseLifecycleState.APPROVED) {
      throw new AppError(
        422,
        "FORBIDDEN_TRANSITION",
        "A revision must reference an Approved test case.",
        "revisesTestCaseId"
      );
    }
  }

  const existing = await prisma.testCase.findUnique({ where: { businessId: input.businessId } });
  if (existing) {
    throw new AppError(409, "ID_DUPLICATE", "Test case ID already exists.", "businessId");
  }

  return prisma.$transaction(async (tx) => {
    const created = await tx.testCase.create({
      data: buildTestCaseCreateData(input, actor)
    });

    await appendAudit(tx, {
      actorId: actor.userId,
      action: "TEST_CASE_CREATED",
      entityType: "TestCase",
      entityId: created.id,
      requestId: actor.requestId,
      beforeAfterJson: { after: created }
    });

    return created;
  });
}

export async function updateTestCaseDraft(
  testCaseId: string,
  input: {
    cycle?: string;
    sprint?: string;
    release?: string;
    environment?: string;
    priority?: string;
    severity?: string;
    title?: string;
    objective?: string;
    expectedResult?: string;
    version?: number;
  },
  actor: Actor
) {
  ensureRole([...RoleSets.canAuthor], actor.role);
  requireNonBlankIfProvided(input.cycle, "cycle", "Cycle cannot be blank.");
  requireNonBlankIfProvided(input.sprint, "sprint", "Sprint cannot be blank.");
  requireNonBlankIfProvided(input.release, "release", "Release cannot be blank.");
  requireNonBlankIfProvided(input.environment, "environment", "Environment cannot be blank.");
  requireNonBlankIfProvided(input.title, "title", "Title cannot be blank.");
  requireNonBlankIfProvided(input.objective, "objective", "Objective cannot be blank.");
  requireNonBlankIfProvided(input.expectedResult, "expectedResult", "Expected result cannot be blank.");

  const current = await prisma.testCase.findUnique({ where: { id: testCaseId } });
  if (!current) throw new AppError(404, "REFERENCE_NOT_FOUND", "Test case not found.", "testCaseId");
  if (current.lifecycleState !== TestCaseLifecycleState.DRAFT) {
    throw new AppError(422, "FORBIDDEN_TRANSITION", "Only a Draft test case can be edited.");
  }
  ensureVersion(current.version, input.version);

  if (input.priority?.trim()) await ensureActiveControlledValue(CATALOGUE_PRIORITY, input.priority.trim(), "priority");
  if (input.severity?.trim()) await ensureActiveControlledValue(CATALOGUE_SEVERITY, input.severity.trim(), "severity");

  return prisma.$transaction(async (tx) => {
    const updated = await tx.testCase.update({
      where: { id: testCaseId },
      data: {
        cycle: input.cycle?.trim() ?? current.cycle,
        sprint: input.sprint?.trim() ?? current.sprint,
        release: input.release?.trim() ?? current.release,
        environment: input.environment?.trim() ?? current.environment,
        priority: input.priority?.trim() ?? current.priority,
        severity: input.severity?.trim() ?? current.severity,
        title: input.title?.trim() ?? current.title,
        objective: input.objective?.trim() ?? current.objective,
        expectedResult: input.expectedResult?.trim() ?? current.expectedResult,
        version: { increment: 1 },
        updatedBy: actor.userId
      }
    });
    await appendAudit(tx, {
      actorId: actor.userId,
      action: "TEST_CASE_UPDATED",
      entityType: "TestCase",
      entityId: testCaseId,
      requestId: actor.requestId,
      beforeAfterJson: { before: current, after: updated }
    });
    return updated;
  });
}

export async function replaceSteps(
  testCaseId: string,
  steps: Array<{ sequence: number; action: string; expectedResult: string }>,
  version: number | undefined,
  actor: Actor
) {
  ensureRole([...RoleSets.canAuthor], actor.role);

  const tc = await prisma.testCase.findUnique({ where: { id: testCaseId } });
  if (!tc) throw new AppError(404, "REFERENCE_NOT_FOUND", "Test case not found.", "testCaseId");
  if (tc.lifecycleState !== TestCaseLifecycleState.DRAFT) {
    throw new AppError(422, "FORBIDDEN_TRANSITION", "Only Draft test cases can be edited.");
  }
  ensureVersion(tc.version, version);
  ensureStepSequence(steps);
  steps.forEach((s, i) => {
    requireNonBlank(s.action, `steps.${i}.action`, "Step action is required.");
    requireNonBlank(s.expectedResult, `steps.${i}.expectedResult`, "Step expected result is required.");
  });

  return prisma.$transaction(async (tx) => {
    await tx.testStep.deleteMany({ where: { testCaseId } });
    await tx.testStep.createMany({
      data: steps.map((step) => ({
        testCaseId,
        sequence: step.sequence,
        action: step.action.trim(),
        expectedResult: step.expectedResult.trim(),
        createdBy: actor.userId,
        updatedBy: actor.userId
      }))
    });

    const updated = await tx.testCase.update({
      where: { id: testCaseId },
      data: { version: { increment: 1 }, updatedBy: actor.userId }
    });

    await appendAudit(tx, {
      actorId: actor.userId,
      action: "TEST_CASE_STEPS_REPLACED",
      entityType: "TestCase",
      entityId: testCaseId,
      requestId: actor.requestId,
      beforeAfterJson: { after: { stepCount: steps.length, version: updated.version } }
    });
    return updated;
  });
}

export async function submitTestCase(testCaseId: string, version: number | undefined, actor: Actor) {
  ensureRole([...RoleSets.canAuthor], actor.role);
  const tc = await prisma.testCase.findUnique({ where: { id: testCaseId }, include: { steps: true } });
  if (!tc) throw new AppError(404, "REFERENCE_NOT_FOUND", "Test case not found.", "testCaseId");
  if (tc.lifecycleState !== TestCaseLifecycleState.DRAFT) {
    throw new AppError(422, "FORBIDDEN_TRANSITION", "Only Draft can move to In Review.");
  }
  if (actor.role === QamsRole.QA_ENGINEER && tc.authorUserId !== actor.userId) {
    throw new AppError(403, "UNAUTHORIZED", "QA Engineer can submit only own cases.");
  }
  ensureVersion(tc.version, version);
  if (tc.steps.length < 1) throw new AppError(422, "ID_INVALID", "At least one step is required.", "steps");

  requireNonBlank(tc.cycle, "cycle", "Cycle is required before review.");
  requireNonBlank(tc.sprint, "sprint", "Sprint is required before review.");
  requireNonBlank(tc.release, "release", "Release is required before review.");
  requireNonBlank(tc.environment, "environment", "Environment is required before review.");
  requireNonBlank(tc.priority, "priority", "Priority is required before review.");
  requireNonBlank(tc.severity, "severity", "Severity is required before review.");
  await ensureActiveControlledValue(CATALOGUE_PRIORITY, tc.priority, "priority");
  await ensureActiveControlledValue(CATALOGUE_SEVERITY, tc.severity, "severity");

  return prisma.$transaction(async (tx) => {
    const updated = await tx.testCase.update({
      where: { id: testCaseId },
      data: {
        lifecycleState: TestCaseLifecycleState.IN_REVIEW,
        version: { increment: 1 },
        updatedBy: actor.userId
      }
    });
    await appendAudit(tx, {
      actorId: actor.userId,
      action: "TEST_CASE_SUBMITTED",
      entityType: "TestCase",
      entityId: testCaseId,
      requestId: actor.requestId,
      beforeAfterJson: { after: { lifecycleState: updated.lifecycleState } }
    });
    return updated;
  });
}

export async function approveTestCase(testCaseId: string, version: number | undefined, actor: Actor) {
  ensureRole([...RoleSets.canApprove], actor.role);
  const tc = await prisma.testCase.findUnique({ where: { id: testCaseId } });
  if (!tc) throw new AppError(404, "REFERENCE_NOT_FOUND", "Test case not found.", "testCaseId");
  if (tc.lifecycleState !== TestCaseLifecycleState.IN_REVIEW) {
    throw new AppError(422, "FORBIDDEN_TRANSITION", "Only In Review can be approved.");
  }
  if (actor.role === QamsRole.SENIOR_QA_ENGINEER && tc.authorUserId === actor.userId) {
    throw new AppError(403, "UNAUTHORIZED", "Senior QA Engineer cannot approve own case.");
  }
  ensureVersion(tc.version, version);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.testCase.update({
      where: { id: testCaseId },
      data: {
        lifecycleState: TestCaseLifecycleState.APPROVED,
        version: { increment: 1 },
        updatedBy: actor.userId
      }
    });
    await appendAudit(tx, {
      actorId: actor.userId,
      action: "TEST_CASE_APPROVED",
      entityType: "TestCase",
      entityId: testCaseId,
      requestId: actor.requestId,
      beforeAfterJson: { after: { lifecycleState: updated.lifecycleState } }
    });
    return updated;
  });
}

export async function returnTestCaseToDraft(
  testCaseId: string,
  payload: { version?: number; reviewReason: string },
  actor: Actor
) {
  ensureRole([...RoleSets.canApprove], actor.role);
  requireNonBlank(payload.reviewReason, "reviewReason", "Review feedback reason is required.");
  const tc = await prisma.testCase.findUnique({ where: { id: testCaseId } });
  if (!tc) throw new AppError(404, "REFERENCE_NOT_FOUND", "Test case not found.", "testCaseId");
  if (tc.lifecycleState !== TestCaseLifecycleState.IN_REVIEW) {
    throw new AppError(422, "FORBIDDEN_TRANSITION", "Only In Review can be returned to Draft.");
  }
  ensureVersion(tc.version, payload.version);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.testCase.update({
      where: { id: testCaseId },
      data: {
        lifecycleState: TestCaseLifecycleState.DRAFT,
        reviewReason: payload.reviewReason.trim(),
        version: { increment: 1 },
        updatedBy: actor.userId
      }
    });
    await appendAudit(tx, {
      actorId: actor.userId,
      action: "TEST_CASE_RETURNED_TO_DRAFT",
      entityType: "TestCase",
      entityId: testCaseId,
      requestId: actor.requestId,
      beforeAfterJson: { after: { lifecycleState: updated.lifecycleState, reviewReason: updated.reviewReason } }
    });
    return updated;
  });
}

export async function retireTestCase(
  testCaseId: string,
  payload: { version?: number; retirementReason: string },
  actor: Actor
) {
  ensureRole([...RoleSets.canApprove], actor.role);
  requireNonBlank(payload.retirementReason, "retirementReason", "Retirement reason is required.");
  const tc = await prisma.testCase.findUnique({ where: { id: testCaseId } });
  if (!tc) throw new AppError(404, "REFERENCE_NOT_FOUND", "Test case not found.", "testCaseId");
  if (tc.lifecycleState !== TestCaseLifecycleState.APPROVED) {
    throw new AppError(422, "FORBIDDEN_TRANSITION", "Only Approved can be retired.");
  }
  ensureVersion(tc.version, payload.version);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.testCase.update({
      where: { id: testCaseId },
      data: {
        lifecycleState: TestCaseLifecycleState.RETIRED,
        retirementReason: payload.retirementReason.trim(),
        version: { increment: 1 },
        updatedBy: actor.userId
      }
    });
    await appendAudit(tx, {
      actorId: actor.userId,
      action: "TEST_CASE_RETIRED",
      entityType: "TestCase",
      entityId: testCaseId,
      requestId: actor.requestId,
      beforeAfterJson: { after: { lifecycleState: updated.lifecycleState } }
    });
    return updated;
  });
}
