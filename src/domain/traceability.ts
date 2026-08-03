import { QamsRole, TestCaseLifecycleState } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { ensureRole, RoleSets } from "@/lib/rbac";
import { requireNonBlank } from "@/lib/validation";
import { appendAudit } from "@/lib/audit";
import { runPaged, type PageRequest } from "@/lib/pagination";

export async function listRtmLinks(options: PageRequest = {}) {
  return runPaged(
    options,
    (window) =>
      prisma.requirementTraceLink.findMany({ orderBy: { createdAt: "desc" }, ...window }),
    () => prisma.requirementTraceLink.count()
  );
}

/**
 * Trace links with the three records they point at, for the RTM screen.
 *
 * The screen used to load every requirement, every test case and every defect purely to
 * build id→businessId maps for the link rows. Joining here means one page of links
 * carries its own labels, and those three full-table reads disappear.
 */
export async function listRtmLinksWithRefs(options: PageRequest = {}) {
  return runPaged(
    options,
    (window) =>
      prisma.requirementTraceLink.findMany({
        include: {
          requirement: { select: { id: true, businessId: true } },
          testCase: { select: { id: true, businessId: true, title: true } },
          defect: { select: { id: true, businessId: true } }
        },
        orderBy: { createdAt: "desc" },
        ...window
      }),
    () => prisma.requirementTraceLink.count()
  );
}

/**
 * Requirements carrying no trace link at all — the gap list that is the point of an RTM.
 *
 * `none: {}` is the whole computation, so this no longer means reading every requirement
 * and every link to subtract one set from the other in JavaScript. The count is the
 * server's, so the "N requirements without any link" line stays true beyond page 1.
 */
export async function listRequirementsWithoutTraceLinks(options: PageRequest = {}) {
  const where = { rtmLinks: { none: {} } };
  return runPaged(
    options,
    (window) => prisma.requirement.findMany({ where, orderBy: { businessId: "asc" }, ...window }),
    () => prisma.requirement.count({ where })
  );
}

/**
 * The three pickers on the "New trace link" form. Unpaged by necessity — a picker has to
 * offer every candidate — but projected to the columns the form actually renders rather
 * than whole records with their audit columns and step lists.
 */
export async function listTraceLinkOptions() {
  const [requirements, testCases, defects] = await Promise.all([
    prisma.requirement.findMany({
      select: { id: true, businessId: true, statement: true },
      orderBy: { businessId: "asc" }
    }),
    prisma.testCase.findMany({
      select: { id: true, businessId: true, title: true, requirementId: true },
      orderBy: { businessId: "asc" }
    }),
    prisma.defect.findMany({
      select: { id: true, businessId: true, summary: true, testCaseId: true },
      orderBy: { businessId: "asc" }
    })
  ]);
  return { requirements, testCases, defects };
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

/** How many weeks of finalization history the trend reports. */
const TREND_WEEKS = 12;

/**
 * Finalized executions per ISO week, oldest first, with EMPTY WEEKS PRESENT as zero.
 *
 * Filling the gaps is the point. `GROUP BY` returns only weeks that have rows, and a
 * chart drawn straight from that silently closes the gaps — a fortnight with no testing
 * renders as an unbroken run of activity. Generating the buckets and merging the counts
 * in means a quiet week looks quiet.
 *
 * This is a COUNT over time, not a rate: `business-rules-and-validation.md:39` defines no
 * percentage or target, so nothing here is divided or graded.
 */
async function finalizedExecutionsByWeek(weeks: number) {
  /*
   * Postgres owns the week boundaries end to end: `generate_series` produces the buckets,
   * a LEFT JOIN fills them, and `to_char` returns the key as TEXT.
   *
   * That last part is not fussiness. `date_trunc('week', …)` yields `timestamp without
   * time zone`, and drivers disagree about whether to read that as UTC or as server-local
   * — the same bucket came back as 2026-08-02 through node-postgres and 2026-08-03
   * through Prisma on a UTC+8 machine. Generating the buckets in JavaScript and matching
   * them against parsed Dates therefore worked only by accident of which driver was in
   * play; in the other timezone every bucket silently misses and the whole trend reads
   * zero. A text key cannot be misparsed, and `now() AT TIME ZONE 'UTC'` keeps the
   * comparison in the same timestamp space Prisma stores.
   */
  return prisma.$queryRaw<Array<{ weekStartUtc: string; count: number }>>`
    SELECT to_char(w.week_start, 'YYYY-MM-DD') AS "weekStartUtc",
           count(e.id)::int AS count
    FROM generate_series(
           date_trunc('week', (now() AT TIME ZONE 'UTC')) - make_interval(weeks => ${weeks - 1}),
           date_trunc('week', (now() AT TIME ZONE 'UTC')),
           interval '1 week'
         ) AS w(week_start)
    LEFT JOIN "TestExecution" e
      ON e."state" = 'FINALIZED'
     AND e."finalizedAt" IS NOT NULL
     AND date_trunc('week', e."finalizedAt") = w.week_start
    GROUP BY w.week_start
    ORDER BY w.week_start
  `;
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

  // The added breakdowns. Every one is a COUNT: `business-rules-and-validation.md:39`
  // defines no percentage, threshold or ageing target, so none is derived here — a
  // pass rate or a coverage percentage would be inventing policy, not reporting.
  const [
    caseStates,
    executionStates,
    defectStates,
    requirementsLinked,
    requirementsUnlinked,
    executionTotal,
    defectTotal,
    weeklyFinalized
  ] = await Promise.all([
    // Retired excluded, matching the Test cases KPI above and `:38`.
    prisma.testCase.groupBy({
      by: ["lifecycleState"],
      _count: true,
      where: { lifecycleState: { not: "RETIRED" } }
    }),
    prisma.testExecution.groupBy({ by: ["state"], _count: true }),
    prisma.defect.groupBy({ by: ["status"], _count: true }),
    prisma.requirement.count({ where: { rtmLinks: { some: {} } } }),
    prisma.requirement.count({ where: { rtmLinks: { none: {} } } }),
    prisma.testExecution.count(),
    prisma.defect.count(),
    finalizedExecutionsByWeek(TREND_WEEKS)
  ]);

  return {
    asOfUtc,
    products,
    testCases,
    testCasesByLifecycleState: statedMetric(caseStates, testCases, asOfUtc, {
      filters: "test case lifecycleState != RETIRED, per the dashboard exclusion rule",
      numerator: "non-retired test cases in the row's lifecycle state",
      denominator: "all non-retired test cases"
    }),
    executionsByState: statedMetric(executionStates, executionTotal, asOfUtc, {
      filters: "none; every execution regardless of covered-case lifecycle state",
      numerator: "executions in the row's lifecycle state",
      denominator: "all executions"
    }),
    defectsByStatus: statedMetric(defectStates, defectTotal, asOfUtc, {
      filters: "none; every defect including Closed",
      numerator: "defects in the row's status",
      denominator: "all defects"
    }),
    /**
     * Linked vs unlinked REQUIREMENT COUNTS, never a coverage percentage.
     * `business-rules-and-validation.md:36` is explicit that the system "does not infer
     * that an unlinked requirement is covered" — so this reports how many carry a trace
     * link and how many do not, and draws no conclusion from the ratio.
     */
    requirementTraceLinkage: statedMetric(
      [
        { linkage: "Has at least one trace link", _count: requirementsLinked },
        { linkage: "No trace link recorded", _count: requirementsUnlinked }
      ],
      requirementsLinked + requirementsUnlinked,
      asOfUtc,
      {
        filters: "none; every requirement",
        numerator: "requirements in the row's linkage state",
        denominator: "all requirements"
      }
    ),
    finalizedExecutionsByWeek: statedMetric(
      weeklyFinalized,
      weeklyFinalized.reduce((sum, week) => sum + week.count, 0),
      asOfUtc,
      {
        filters: `execution state = FINALIZED, finalized within the last ${TREND_WEEKS} ISO weeks (UTC)`,
        numerator: "executions finalized during the row's week",
        denominator: `all executions finalized in the last ${TREND_WEEKS} weeks`
      }
    ),
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
