import { QamsRole, TestCaseLifecycleState } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { ensureRole, RoleSets } from "@/lib/rbac";
import { requireNonBlank } from "@/lib/validation";
import { appendAudit } from "@/lib/audit";

export async function listRtmLinks() {
  return prisma.requirementTraceLink.findMany({ orderBy: { createdAt: "desc" } });
}

export async function createRtmLink(input: {
  requirementId: string;
  testCaseId: string;
  defectId?: string;
  actorId: string;
  actorRole: QamsRole;
  requestId: string;
}) {
  ensureRole([...RoleSets.canAuthor], input.actorRole);

  const requirement = await prisma.requirement.findUnique({
    where: { id: input.requirementId },
    include: { feature: { include: { module: true } } }
  });
  const testCase = await prisma.testCase.findUnique({
    where: { id: input.testCaseId },
    include: { feature: { include: { module: true } } }
  });
  if (!requirement || !testCase) {
    throw new AppError(404, "REFERENCE_NOT_FOUND", "Requirement or test case was not found.");
  }

  if (
    requirement.id !== testCase.requirementId ||
    requirement.feature.id !== testCase.featureId ||
    requirement.feature.module.id !== testCase.moduleId ||
    requirement.feature.module.productId !== testCase.productId
  ) {
    throw new AppError(
      422,
      "HIERARCHY_MISMATCH",
      "The requirement does not belong to the supplied feature.",
      "requirementId"
    );
  }

  if (input.defectId) {
    const defect = await prisma.defect.findUnique({ where: { id: input.defectId } });
    if (!defect || defect.testCaseId !== input.testCaseId) {
      throw new AppError(422, "HIERARCHY_MISMATCH", "Defect must reference the same test case.", "defectId");
    }
  }

  return prisma.$transaction(async (tx) => {
    const link = await tx.requirementTraceLink.create({
      data: {
        requirementId: input.requirementId,
        testCaseId: input.testCaseId,
        defectId: input.defectId,
        createdBy: input.actorId
      }
    });

    await appendAudit(tx, {
      actorId: input.actorId,
      action: "RTM_LINK_CREATED",
      entityType: "RequirementTraceLink",
      entityId: link.id,
      requestId: input.requestId,
      beforeAfterJson: { after: link }
    });

    return link;
  });
}

export async function dashboardSnapshot() {
  const [products, testCases, executions, defects] = await Promise.all([
    prisma.product.count({ where: { status: { not: { equals: "Retired", mode: "insensitive" } } } }),
    prisma.testCase.count({ where: { lifecycleState: { not: "RETIRED" } } }),
    prisma.testExecution.groupBy({ by: ["result"], _count: true, where: { state: "FINALIZED" } }),
    prisma.defect.groupBy({ by: ["severity"], _count: true, where: { status: { not: "CLOSED" } } })
  ]);

  return {
    asOfUtc: new Date().toISOString(),
    products,
    testCases,
    executionFinalizedByResult: executions,
    openDefectsBySeverity: defects
  };
}

export async function releaseReadinessSnapshot(
  input: { productId: string; release: string; environment: string },
  actorRole: QamsRole
) {
  ensureRole([...RoleSets.canAdmin], actorRole);
  requireNonBlank(input.productId, "productId", "Product is required.");
  requireNonBlank(input.release, "release", "Release is required.");
  requireNonBlank(input.environment, "environment", "Environment is required.");

  const product = await prisma.product.findUnique({ where: { id: input.productId } });
  if (!product) throw new AppError(404, "REFERENCE_NOT_FOUND", "Product not found.", "productId");

  const scopedTestCases = await prisma.testCase.findMany({
    where: {
      productId: input.productId,
      release: input.release,
      environment: input.environment,
      lifecycleState: TestCaseLifecycleState.APPROVED
    },
    select: { id: true }
  });
  const testCaseIds = scopedTestCases.map((tc) => tc.id);

  const [executionFinalizedByResult, openDefectsBySeverity, requirements] = await Promise.all([
    prisma.testExecution.groupBy({
      by: ["result"],
      _count: true,
      where: { testCaseId: { in: testCaseIds }, state: "FINALIZED" }
    }),
    prisma.defect.groupBy({
      by: ["severity"],
      _count: true,
      where: { testCaseId: { in: testCaseIds }, status: { not: "CLOSED" } }
    }),
    prisma.requirement.findMany({
      where: { feature: { module: { productId: input.productId } } },
      include: { rtmLinks: true }
    })
  ]);

  const requirementsWithoutTraceLinks = requirements
    .filter((requirement) => requirement.rtmLinks.length === 0)
    .map((requirement) => requirement.businessId);

  return {
    asOfUtc: new Date().toISOString(),
    scope: { productId: input.productId, release: input.release, environment: input.environment },
    approvedTestCaseCount: testCaseIds.length,
    executionFinalizedByResult,
    openDefectsBySeverity,
    requirementsWithoutTraceLinks,
    advisory: true,
    policy: "POLICY_NOT_DEFINED",
    message:
      "The QAMS knowledge base does not establish pass-rate thresholds or defect-severity release gates. This report is advisory only; the QA Lead must record a readiness decision and rationale separately and escalate before applying any unwritten threshold."
  };
}
