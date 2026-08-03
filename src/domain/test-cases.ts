import { Prisma, QamsRole, TestCaseLifecycleState } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { ensureRole, RoleSets } from "@/lib/rbac";
import { ensureStepSequence, ensureVersion, requireNonBlank, requireNonBlankIfProvided } from "@/lib/validation";
import { withVersionCheck } from "@/lib/optimistic-lock";
import { BUSINESS_ID_PATTERNS, ensureBusinessIdFormat } from "@/lib/business-ids";
import { allocateBusinessId, highestSuffix } from "@/lib/id-allocator";
import { ensureActiveControlledValue } from "@/lib/controlled-values";
import { CATALOGUE_PRIORITY, CATALOGUE_SEVERITY } from "@/lib/controlled-value-catalogues";
import { appendAudit } from "@/lib/audit";
import { runPaged, type PageRequest } from "@/lib/pagination";

type Actor = { userId: string; role: QamsRole; requestId: string };

export type CreateTestCaseInput = {
  /** Optional: when absent the create transaction allocates the next free TC-<PRODUCT>-####. */
  businessId?: string;
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

export type TestCaseListOptions = PageRequest & {
  /** Needle matched against business ID, title, and the raw lifecycle state name. */
  query?: string;
  /** Restrict to these lifecycle states — the review queue and the drafts screen. */
  states?: TestCaseLifecycleState[];
  /** Restrict to one author: "my drafts". */
  authorUserId?: string;
};

/**
 * The `where` for every filtered test-case read, so the review queue, the drafts screen
 * and the search box compose instead of each re-filtering a full table in JavaScript.
 *
 * The needle is matched against the RAW lifecycle state (`IN_REVIEW`), which is what the
 * previous in-browser filter concatenated and matched — preserved deliberately so
 * existing muscle memory keeps working.
 */
function testCaseWhere(options: TestCaseListOptions): Prisma.TestCaseWhereInput {
  const needle = options.query?.trim() ?? "";
  const all: Prisma.TestCaseWhereInput[] = [];

  if (options.states && options.states.length > 0) all.push({ lifecycleState: { in: options.states } });
  if (options.authorUserId) all.push({ authorUserId: options.authorUserId });

  if (needle !== "") {
    const matchingStates = Object.values(TestCaseLifecycleState).filter((state) =>
      state.toLowerCase().includes(needle.toLowerCase())
    );
    all.push({
      OR: [
        { businessId: { contains: needle, mode: "insensitive" } },
        { title: { contains: needle, mode: "insensitive" } },
        ...(matchingStates.length > 0 ? [{ lifecycleState: { in: matchingStates } }] : [])
      ]
    });
  }

  return all.length === 0 ? {} : { AND: all };
}

export async function listTestCases(options: TestCaseListOptions = {}) {
  const where = testCaseWhere(options);
  return runPaged(
    options,
    (window) =>
      prisma.testCase.findMany({
        where,
        include: { steps: { orderBy: { sequence: "asc" } } },
        orderBy: { businessId: "asc" },
        ...window
      }),
    () => prisma.testCase.count({ where })
  );
}

/** Cases waiting for a reviewer — powers the Review badge in the navigation. */
export async function reviewQueueCount() {
  return prisma.testCase.count({ where: { lifecycleState: TestCaseLifecycleState.IN_REVIEW } });
}

export async function getTestCase(id: string) {
  const row = await prisma.testCase.findUnique({
    where: { id },
    include: { steps: { orderBy: { sequence: "asc" } } }
  });
  if (!row) throw new AppError(404, "REFERENCE_NOT_FOUND", "Test case not found.", "id");
  return row;
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
  input: CreateTestCaseInput & { businessId: string },
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
  requireNonBlank(input.title, "title", "Title is required.");
  requireNonBlank(input.objective, "objective", "Objective is required.");
  requireNonBlank(input.expectedResult, "expectedResult", "Expected result is required.");

  // `businessId` is optional (`docs/business-rules-and-validation.md:11`): supplied IDs
  // are validated exactly as before; when absent the transaction allocates the next
  // free TC-<PRODUCT>-#### below, numbered per owning product (`docs/data-model.md`).
  const suppliedId = input.businessId?.trim();
  if (input.businessId !== undefined) {
    requireNonBlank(input.businessId, "businessId", "Test case ID cannot be blank.");
    ensureBusinessIdFormat(input.businessId, BUSINESS_ID_PATTERNS.testCase, "businessId", "TC-<PRODUCT>-####");
  }

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

  if (suppliedId) {
    const existing = await prisma.testCase.findUnique({ where: { businessId: suppliedId } });
    if (existing) {
      throw new AppError(409, "ID_DUPLICATE", "Test case ID already exists.", "businessId");
    }
  }

  // The generated tag is the owning product's business ID (`docs/data-model.md:22`).
  // validateHierarchy already proved the product exists (the module chains to it).
  const product = suppliedId
    ? null
    : await prisma.product.findUnique({ where: { id: input.productId }, select: { businessId: true } });
  if (!suppliedId && !product) {
    throw new AppError(404, "REFERENCE_NOT_FOUND", "Product was not found.", "productId");
  }

  return prisma.$transaction(async (tx) => {
    const prefix = `TC-${product?.businessId}-`;
    const businessId =
      suppliedId ??
      (await allocateBusinessId(tx, `testCase:${product?.businessId}`, {
        prefix,
        isTaken: async (candidate) =>
          (await tx.testCase.findUnique({ where: { businessId: candidate }, select: { id: true } })) !== null,
        currentMax: async () =>
          highestSuffix(
            prefix,
            (
              await tx.testCase.findMany({
                where: { businessId: { startsWith: prefix } },
                select: { businessId: true }
              })
            ).map((row) => row.businessId)
          )
      }));
    const created = await tx.testCase.create({
      data: buildTestCaseCreateData({ ...input, businessId }, actor)
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
  const expectedVersion = ensureVersion(current.version, input.version);

  if (input.priority?.trim()) await ensureActiveControlledValue(CATALOGUE_PRIORITY, input.priority.trim(), "priority");
  if (input.severity?.trim()) await ensureActiveControlledValue(CATALOGUE_SEVERITY, input.severity.trim(), "severity");

  return withVersionCheck(() => prisma.$transaction(async (tx) => {
    const updated = await tx.testCase.update({
      where: { id: testCaseId, version: expectedVersion },
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
  }));
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
  const expectedVersion = ensureVersion(tc.version, version);
  ensureStepSequence(steps);
  steps.forEach((s, i) => {
    requireNonBlank(s.action, `steps.${i}.action`, "Step action is required.");
    requireNonBlank(s.expectedResult, `steps.${i}.expectedResult`, "Step expected result is required.");
  });

  return withVersionCheck(() => prisma.$transaction(async (tx) => {
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
      where: { id: testCaseId, version: expectedVersion },
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
  }));
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
  const expectedVersion = ensureVersion(tc.version, version);
  if (tc.steps.length < 1) throw new AppError(422, "ID_INVALID", "At least one step is required.", "steps");

  requireNonBlank(tc.cycle, "cycle", "Cycle is required before review.");
  requireNonBlank(tc.sprint, "sprint", "Sprint is required before review.");
  requireNonBlank(tc.release, "release", "Release is required before review.");
  requireNonBlank(tc.environment, "environment", "Environment is required before review.");
  requireNonBlank(tc.priority, "priority", "Priority is required before review.");
  requireNonBlank(tc.severity, "severity", "Severity is required before review.");
  await ensureActiveControlledValue(CATALOGUE_PRIORITY, tc.priority, "priority");
  await ensureActiveControlledValue(CATALOGUE_SEVERITY, tc.severity, "severity");

  return withVersionCheck(() => prisma.$transaction(async (tx) => {
    const updated = await tx.testCase.update({
      where: { id: testCaseId, version: expectedVersion },
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
  }));
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
  const expectedVersion = ensureVersion(tc.version, version);

  return withVersionCheck(() => prisma.$transaction(async (tx) => {
    const updated = await tx.testCase.update({
      where: { id: testCaseId, version: expectedVersion },
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
  }));
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
  const expectedVersion = ensureVersion(tc.version, payload.version);

  return withVersionCheck(() => prisma.$transaction(async (tx) => {
    const updated = await tx.testCase.update({
      where: { id: testCaseId, version: expectedVersion },
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
  }));
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
  const expectedVersion = ensureVersion(tc.version, payload.version);

  return withVersionCheck(() => prisma.$transaction(async (tx) => {
    const updated = await tx.testCase.update({
      where: { id: testCaseId, version: expectedVersion },
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
  }));
}
