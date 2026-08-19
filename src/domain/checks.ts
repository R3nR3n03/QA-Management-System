import { randomUUID } from "node:crypto";
import { CheckOutcome, QamsRole, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { appendAudit } from "@/lib/audit";
import { AppError, type ErrorCode } from "@/lib/errors";
import { parseJUnitXml } from "@/lib/junit-xml";
import { runPaged, type PageRequest } from "@/lib/pagination";
import { ensureRole, RoleSets } from "@/lib/rbac";

/**
 * Automation check ingestion (`docs/architecture.md#Automation check ingestion`).
 *
 * QAMS records what an automation suite observed about its test cases. It does not run one,
 * and this module is the whole of what it does with the results: parse an uploaded JUnit XML
 * file, resolve each declared test case business ID, and write one **check** per test.
 *
 * A check is a REPORT, never a claim (ADR-0008). Nothing here creates, alters or finalizes an
 * execution, raises a defect, writes a trace link, or moves any readiness or dashboard figure
 * — and there is no parameter that would let it. If a future change makes that untrue, the
 * acceptance suite's "what ingestion must not touch" block is what should fail.
 */

type Actor = { userId: string; role: QamsRole; requestId: string };

/**
 * How many checks a test case's screen shows before it says how much it left out.
 *
 * Storage is unbounded and append-only, so a case checked nightly for a year has hundreds of
 * rows. The screen must never render a truncated list as if it were the whole history —
 * `docs/architecture.md` requires it to state the omission, on the same rule a Jira result
 * comment follows when it caps the cases it lists.
 */
export const TEST_CASE_CHECK_LIMIT = 20;

/**
 * How long the write is allowed to take.
 *
 * Prisma's default interactive-transaction budget is 5 seconds, which a real results file can
 * exceed — the upload cap is 10 MB and a full suite run is thousands of tests. Exceeding it
 * aborts with P2028 and rolls everything back, so a large legitimate upload would fail with
 * nothing recorded. `src/domain/imports.ts` reaches for the same 60 seconds for the same
 * reason.
 */
const INGEST_TIMEOUT_MS = 60_000;

/**
 * What became of one `<testcase>` in the uploaded file.
 *
 * `CREATED` is the only outcome that wrote a check. The other two record a row that was in
 * the file and produced nothing, which is the only place that fact is kept — one mis-named
 * spec must never discard a run's other results, so these are reported rather than thrown.
 */
export type CheckRowOutcome = "CREATED" | "REFERENCE_NOT_FOUND" | "NO_TEST_CASE_DECLARED";

export type CheckRowReport = {
  specName: string;
  testName: string;
  businessId: string | null;
  outcome: CheckRowOutcome;
  checkOutcome: CheckOutcome | null;
  checkId: string | null;
  errorCode: ErrorCode | null;
};

export type CheckBatchReport = {
  rows: CheckRowReport[];
  counts: Record<string, number>;
};

function tally(rows: CheckRowReport[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const key = row.outcome === "CREATED" ? (row.checkOutcome as string) : row.outcome;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/**
 * Ingest one JUnit XML results file.
 *
 * The role gate lives HERE and not only in the route, because `docs/api-and-security.md`
 * requires the matrix be enforced in domain services and `roles-workflows.md` confines this
 * to a QA Lead — the same reasoning that moved the workbook import's gate into its service.
 *
 * The parse and the resolution both run BEFORE the transaction opens, so a malformed file
 * leaves nothing behind at all: no batch, no checks, no audit event. A file QAMS cannot read
 * says nothing about any test case, and a half-ingested run would report something that did
 * not happen.
 *
 * The write is one transaction and one `createMany`, so it is all-or-nothing. There is
 * deliberately no upsert and no reconciliation: two uploads of one file are two sets of
 * observations, and neither supersedes the other (ADR-0008).
 */
export async function createCheckBatch(actor: Actor, fileName: string, xml: string) {
  ensureRole([...RoleSets.canAdmin], actor.role);

  // Throws before anything is persisted. See the note above.
  const parsed = parseJUnitXml(xml);

  // One instant for the whole file. Every test in a results file belongs to one run, and
  // stamping them individually would invent an ordering the file never claimed.
  const checkedAt = new Date();

  const declared = [...new Set(parsed.map((p) => p.businessId).filter((id): id is string => id !== null))];
  const cases = declared.length
    ? await prisma.testCase.findMany({
        where: { businessId: { in: declared } },
        select: { id: true, businessId: true }
      })
    : [];
  const byBusinessId = new Map(cases.map((c) => [c.businessId, c.id]));

  // Decide everything first, so the transaction below is two statements rather than one per
  // test. IDs are generated here rather than by the database because the row report names
  // the check each row produced, and `createMany` does not return what it wrote.
  const batchId = randomUUID();
  const rows: CheckRowReport[] = [];
  const checkData: Prisma.CheckCreateManyInput[] = [];

  for (const test of parsed) {
    const base = { specName: test.specName, testName: test.testName, businessId: test.businessId };

    if (test.businessId === null) {
      rows.push({ ...base, outcome: "NO_TEST_CASE_DECLARED", checkOutcome: null, checkId: null, errorCode: null });
      continue;
    }

    const testCaseId = byBusinessId.get(test.businessId);
    if (!testCaseId) {
      rows.push({
        ...base,
        outcome: "REFERENCE_NOT_FOUND",
        checkOutcome: null,
        checkId: null,
        errorCode: "REFERENCE_NOT_FOUND"
      });
      continue;
    }

    const checkId = randomUUID();
    checkData.push({
      id: checkId,
      checkBatchId: batchId,
      testCaseId,
      specName: test.specName,
      testName: test.testName,
      checkedAt,
      outcome: test.outcome,
      failureReason: test.failureReason,
      createdBy: actor.userId
    });
    rows.push({ ...base, outcome: "CREATED", checkOutcome: test.outcome, checkId, errorCode: null });
  }

  const report: CheckBatchReport = { rows, counts: tally(rows) };

  return prisma.$transaction(
    async (tx) => {
      // Written once, complete. There is no RUNNING state to observe and no FAILED state to
      // record: the batch and its checks commit together or not at all, so a batch row can
      // only ever exist for an ingestion that finished. Carrying a status column would be
      // carrying two values that cannot occur — the objection ADR-0004 raises about sharing
      // an enum, one level down.
      const batch = await tx.checkBatch.create({
        data: {
          id: batchId,
          sourceFileName: fileName,
          actorId: actor.userId,
          completedAt: new Date(),
          reportJson: report as unknown as Prisma.InputJsonValue,
          createdBy: actor.userId
        }
      });

      if (checkData.length > 0) await tx.check.createMany({ data: checkData });

      // The audit event carries the tallies, not the rows: the report is on the batch, and
      // duplicating hundreds of rows into an append-only table nothing prunes would bury it.
      await appendAudit(tx, {
        actorId: actor.userId,
        action: "CHECKS_INGESTED",
        entityType: "CheckBatch",
        entityId: batch.id,
        requestId: actor.requestId,
        beforeAfterJson: {
          before: null,
          after: { sourceFileName: fileName, counts: report.counts, rowCount: rows.length }
        }
      });

      return { ...batch, rows };
    },
    { timeout: INGEST_TIMEOUT_MS }
  );
}

export async function listCheckBatches(actorRole: QamsRole, options: PageRequest = {}) {
  // A QA Lead capability, on the same rule as workbook imports (`roles-workflows.md`).
  // The list omits row reports; those load per batch.
  ensureRole([...RoleSets.canAdmin], actorRole);
  return runPaged(
    options,
    // The uploader's name comes with the row so the list can say who carried a file in — the
    // one person a batch records, and NOT someone who verified anything (see `CheckBatch` in
    // the schema). Selected rather than included whole: the list has no use for their role,
    // status or credentials, and a screen cannot leak a field it was never handed.
    (window) =>
      prisma.checkBatch.findMany({
        orderBy: { startedAt: "desc" },
        include: { actor: { select: { displayName: true } } },
        ...window
      }),
    () => prisma.checkBatch.count()
  );
}

/**
 * One batch and its per-row report.
 *
 * Gated, unlike `listChecksForTestCase` below, and the difference is what each one exposes. A
 * check on a test case is about that case, and anyone who may view the case may read it. A
 * batch report is about the upload — every spec name and test name in someone's repository,
 * including the rows that resolved to nothing — which `docs/api-and-security.md` places under
 * Administration.
 */
export async function getCheckBatch(id: string, actorRole: QamsRole) {
  ensureRole([...RoleSets.canAdmin], actorRole);
  const batch = await prisma.checkBatch.findUnique({ where: { id } });
  if (!batch) throw new AppError(404, "REFERENCE_NOT_FOUND", "Check batch not found.", "id");
  const report = (batch.reportJson ?? { rows: [], counts: {} }) as unknown as CheckBatchReport;
  return { ...batch, rows: report.rows ?? [], counts: report.counts ?? {} };
}

/**
 * The checks recorded against one test case, newest first, with the full count beside them.
 *
 * The count is returned rather than inferred from the array's length, because the array is
 * capped: a screen that cannot tell the difference renders a truncated list as a complete
 * history, which is the one way this feature can mislead a reader on its own.
 *
 * No role gate. Reading a check follows the right to view the test case it references
 * (`roles-workflows.md`), which the screen has already established.
 */
export async function listChecksForTestCase(testCaseId: string, limit: number = TEST_CASE_CHECK_LIMIT) {
  const [checks, total] = await Promise.all([
    prisma.check.findMany({
      where: { testCaseId },
      orderBy: [{ checkedAt: "desc" }, { createdAt: "desc" }],
      take: limit
    }),
    prisma.check.count({ where: { testCaseId } })
  ]);
  return { checks, total };
}

/**
 * The checks one batch actually wrote, for the screen that renders its row report.
 *
 * The report in `reportJson` names the check each row produced but not the test case it
 * landed on, and not the runner's failure reason — both live on the `Check` row. Rather
 * than widen the stored report (which would leave every batch ingested before today
 * without them), the screen joins on `checkId`, which every CREATED row has always
 * carried. Old batches therefore gain the link and the reason too.
 *
 * Gated like `getCheckBatch` and for the same reason: this is about the upload rather
 * than about any one test case, which `docs/api-and-security.md` places under
 * Administration. Deliberately NOT folded into `getCheckBatch` — that function is what
 * `GET /api/v1/check-batches/{id}` returns, and changing its shape would change a
 * documented API surface for the sake of a screen.
 */
export async function listChecksForBatch(batchId: string, actorRole: QamsRole) {
  ensureRole([...RoleSets.canAdmin], actorRole);
  return prisma.check.findMany({
    where: { checkBatchId: batchId },
    select: { id: true, testCaseId: true, failureReason: true }
  });
}
