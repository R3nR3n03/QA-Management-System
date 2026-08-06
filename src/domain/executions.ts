import { ExecutionLifecycleState, ExecutionOutcome, Prisma, QamsRole, TestCaseLifecycleState } from "@prisma/client";
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
  input: { businessId?: string; testCaseIds: string[]; testerId: string },
  actor: Actor
) {
  ensureRole([...RoleSets.canExecute], actor.role);

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

  return withVersionCheck(() => prisma.$transaction(async (tx) => {
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
