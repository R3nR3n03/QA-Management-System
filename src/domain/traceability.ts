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

  // The friendly half of the duplicate check. The authoritative half is the unique index,
  // which since migration 20260731110000 finally covers the NULL-defect case too (B3) — and
  // a P2002 from it now surfaces as 409 ID_DUPLICATE rather than a 500 (B2). This exists so
  // the ordinary case gets a sentence that names the actual problem, because the constraint's
  // generic wording ("a record with that identifier") makes little sense for a trace link,
  // which has no identifier of its own.
  //
  // It does not race safely on its own and is not meant to: two concurrent callers can both
  // pass here, and the index is what stops the second.
  const duplicate = await prisma.requirementTraceLink.findFirst({
    where: {
      requirementId: input.requirementId,
      testCaseId: input.testCaseId,
      defectId: input.defectId ?? null
    }
  });
  if (duplicate) {
    throw new AppError(
      409,
      "ID_DUPLICATE",
      input.defectId
        ? "That requirement, test case and defect are already linked."
        : "That requirement and test case are already linked."
    );
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

/**
 * `business-rules-and-validation.md:37`: "Execution and defect metrics must state
 * filters, numerator, denominator, and as-of time before being shown." So each metric
 * carries its own definition rather than assuming the reader knows the query behind
 * it (implementation audit §5.6). The counts stay in Prisma's groupBy shape.
 */
function statedMetric<T>(
  counts: T[],
  total: number,
  asOfUtc: string,
  statement: { filters: string; numerator: string; denominator: string }
) {
  return { ...statement, denominatorCount: total, asOfUtc, counts };
}

export async function dashboardSnapshot() {
  const asOfUtc = new Date().toISOString();
  const [products, testCases, executions, defects, finalizedTotal, openDefectTotal] = await Promise.all([
    // `mode: "insensitive"` belongs beside `equals`, not nested inside `not: {}` —
    // Prisma rejects the nested form with "Unknown argument `mode`", which made this
    // whole endpoint a 500. Negate with a top-level NOT instead.
    prisma.product.count({ where: { NOT: { status: { equals: "Retired", mode: "insensitive" } } } }),
    prisma.testCase.count({ where: { lifecycleState: { not: "RETIRED" } } }),
    prisma.testExecution.groupBy({ by: ["result"], _count: true, where: { state: "FINALIZED" } }),
    prisma.defect.groupBy({ by: ["severity"], _count: true, where: { status: { not: "CLOSED" } } }),
    prisma.testExecution.count({ where: { state: "FINALIZED" } }),
    prisma.defect.count({ where: { status: { not: "CLOSED" } } })
  ]);

  return {
    asOfUtc,
    products,
    testCases,
    executionFinalizedByResult: statedMetric(executions, finalizedTotal, asOfUtc, {
      filters: "execution state = FINALIZED; no product, release, or environment filter",
      numerator: "finalized executions with the row's result",
      denominator: "all finalized executions"
    }),
    openDefectsBySeverity: statedMetric(defects, openDefectTotal, asOfUtc, {
      filters: "defect status != CLOSED; no product, release, or environment filter",
      numerator: "open defects with the row's severity",
      denominator: "all open defects"
    })
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

  const asOfUtc = new Date().toISOString();
  // Scope is a set of test cases, and an execution may cover cases inside and outside
  // it — so the execution metrics count per-case results (`ExecutionTestCase` rows of
  // finalized executions), not whole executions (`docs/data-model.md:25`).
  const [executionFinalizedByResult, openDefectsBySeverity, requirements, finalizedTotal, openDefectTotal] =
    await Promise.all([
      prisma.executionTestCase.groupBy({
        by: ["result"],
        _count: true,
        where: { testCaseId: { in: testCaseIds }, execution: { state: "FINALIZED" } }
      }),
      prisma.defect.groupBy({
        by: ["severity"],
        _count: true,
        where: { testCaseId: { in: testCaseIds }, status: { not: "CLOSED" } }
      }),
      prisma.requirement.findMany({
        where: { feature: { module: { productId: input.productId } } },
        include: { rtmLinks: true }
      }),
      prisma.executionTestCase.count({
        where: { testCaseId: { in: testCaseIds }, execution: { state: "FINALIZED" } }
      }),
      prisma.defect.count({ where: { testCaseId: { in: testCaseIds }, status: { not: "CLOSED" } } })
    ]);

  const requirementsWithoutTraceLinks = requirements
    .filter((requirement) => requirement.rtmLinks.length === 0)
    .map((requirement) => requirement.businessId);

  const scopeFilters =
    `approved test cases scoped to product ${input.productId}, release "${input.release}", environment "${input.environment}"`;

  return {
    asOfUtc,
    scope: { productId: input.productId, release: input.release, environment: input.environment },
    approvedTestCaseCount: testCaseIds.length,
    executionFinalizedByResult: statedMetric(executionFinalizedByResult, finalizedTotal, asOfUtc, {
      filters: `execution state = FINALIZED; ${scopeFilters}`,
      numerator: "covered test cases of finalized executions with the row's per-case result, within scope",
      denominator: "all covered test cases of finalized executions within scope"
    }),
    openDefectsBySeverity: statedMetric(openDefectsBySeverity, openDefectTotal, asOfUtc, {
      filters: `defect status != CLOSED; ${scopeFilters}`,
      numerator: "open defects with the row's severity, within scope",
      denominator: "all open defects within scope"
    }),
    requirementsWithoutTraceLinks,
    advisory: true,
    policy: "POLICY_NOT_DEFINED",
    message:
      "The QAMS knowledge base does not establish pass-rate thresholds or defect-severity release gates. This report is advisory only; the QA Lead must record a readiness decision and rationale separately and escalate before applying any unwritten threshold."
  };
}
