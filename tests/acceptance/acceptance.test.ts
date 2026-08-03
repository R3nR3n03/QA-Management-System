import { QamsRole, TestCaseLifecycleState, ExecutionLifecycleState, ExecutionOutcome, DefectLifecycleState } from "@prisma/client";
import * as XLSX from "xlsx";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { buildControlledValueSeedRows } from "@/lib/controlled-value-catalogues";
import { createImportRun } from "@/domain/imports";
import { createProduct, createModule, createFeature, createRequirement } from "@/domain/catalogue";
import { createTestCase, replaceSteps, submitTestCase, approveTestCase, updateTestCaseDraft, retireTestCase } from "@/domain/test-cases";
import { createExecution, startExecution, finalizeExecution, executionHistory, updateExecution } from "@/domain/executions";
import { createDefect, transitionDefect } from "@/domain/defects";
import { createRtmLink, dashboardSnapshot } from "@/domain/traceability";
import { createControlledValue, createUser, setUserActive, updateUserProfile, updateUserRole } from "@/domain/admin";
import { ensureActiveControlledValue } from "@/lib/controlled-values";
import { CATALOGUE_PRIORITY, CATALOGUE_SEVERITY } from "@/lib/controlled-value-catalogues";
import { createTestCaseSchema } from "@/lib/request-schemas/test-cases";

/**
 * The implementation acceptance suite from `docs/testing-and-acceptance.md`
 * § "Implementation acceptance suite", automated against a real PostgreSQL database
 * (`qams_test`, prepared by the global setup). `docs/testing-and-acceptance.md:38`
 * makes these scenarios the definition of done; until this file existed, 0 of 17
 * were automated (implementation audit §5.7 / production readiness F3).
 *
 * The scenarios exercise the DOMAIN services, which own every rule, status and error
 * code (`architecture.md:33` — route handlers only authenticate, validate shape, call
 * one service). HTTP status and error code are asserted from `AppError`, which is
 * exactly what `withRoute` serializes; the boundary schemas have their own unit
 * tests under `src/lib/request-schemas/`.
 *
 * The file is one sequential story sharing one database: the import scenarios run
 * first and later scenarios build on their own interactive records. One worker,
 * one file — see `vitest.acceptance.config.ts`.
 */

type Actor = { userId: string; role: QamsRole; requestId: string };

const REQ = "acceptance-suite";

let lead: Actor;
let senior: Actor;
let engineer: Actor;
let tester: Actor;

const TESTER_DISPLAY_NAME = "Accept Tester";

async function truncateAll() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  const joined = tables.map((t) => `"${t.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${joined} RESTART IDENTITY CASCADE`);
}

async function makeUser(email: string, displayName: string, role: QamsRole): Promise<Actor> {
  const user = await prisma.user.create({
    data: { email, displayName, role, passwordHash: "not-a-real-hash", createdBy: "test", updatedBy: "test" }
  });
  return { userId: user.id, role, requestId: REQ };
}

async function expectAppError(promise: Promise<unknown>, status: number, code?: string): Promise<AppError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    const appError = err as AppError;
    expect(appError.status).toBe(status);
    if (code) expect(appError.code).toBe(code);
    return appError;
  }
  throw new Error(`Expected AppError ${status}${code ? ` ${code}` : ""}, but the call succeeded.`);
}

/** All 13 documented sheets, with one valid row per imported sheet. */
function workbookSheets(): Record<string, (string | number)[][]> {
  return {
    Home: [["QAMS"]],
    "Product Master": [
      ["Product ID", "Product", "Version", "Status"],
      ["PROD001", "Alpha", "1.0", "Active"]
    ],
    "Module Master": [
      ["Module ID", "Product ID", "Module"],
      ["MOD001", "PROD001", "Login"]
    ],
    "Feature Master": [
      ["Feature ID", "Module ID", "Feature"],
      ["FEAT001", "MOD001", "Login form"]
    ],
    "Requirement Master": [
      ["Requirement ID", "Feature ID", "Requirement"],
      ["REQ001", "FEAT001", "A user can sign in"]
    ],
    "Test Repository": [
      ["TC ID", "Product ID", "Module ID", "Feature ID", "Requirement ID", "Cycle", "Sprint", "Release", "Environment", "Priority", "Severity", "Title", "Objective", "Expected Result", "Execution Status"],
      ["TC-PROD001-0001", "PROD001", "MOD001", "FEAT001", "REQ001", "C1", "S1", "R1", "QA", "High", "Major", "Login works", "Verify a user can sign in", "User lands on the dashboard", "Not Executed"]
    ],
    "Test Steps": [
      ["TC ID", "Step", "Action", "Expected"],
      ["TC-PROD001-0001", 1, "Open the login page", "The form is shown"]
    ],
    "Test Execution": [
      ["Execution ID", "TC ID", "Tester", "Result", "Bug"],
      ["EXE-0001", "TC-PROD001-0001", TESTER_DISPLAY_NAME, "Pass", ""]
    ],
    "Execution History": [
      ["Execution ID", "TC ID", "Result", "Date"],
      ["EXE-0001", "TC-PROD001-0001", "Pass", "2026-01-15"]
    ],
    "Bug Tracker": [
      ["Bug ID", "TC ID", "Summary", "Status"],
      ["BUG-0001", "TC-PROD001-0001", "Login button mislabeled", "New"]
    ],
    RTM: [
      ["Requirement ID", "TC ID", "Bug ID"],
      ["REQ001", "TC-PROD001-0001", ""]
    ],
    Dashboard: [["Derived in the application"]],
    Settings: [
      ["Priority", "Severity", "Result"],
      ["High", "Critical", "Pass"],
      ["Medium", "Major", "Fail"],
      ["Low", "Minor", "Blocked"]
    ]
  };
}

function buildWorkbook(mutate?: (sheets: Record<string, (string | number)[][]>) => void): Buffer {
  const sheets = workbookSheets();
  mutate?.(sheets);
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

beforeAll(async () => {
  await truncateAll();
  await prisma.controlledValue.createMany({ data: [...buildControlledValueSeedRows("test")] });
  lead = await makeUser("lead@acceptance.local", "Accept Lead", QamsRole.QA_LEAD);
  senior = await makeUser("senior@acceptance.local", "Accept Senior", QamsRole.SENIOR_QA_ENGINEER);
  engineer = await makeUser("engineer@acceptance.local", "Accept Engineer", QamsRole.QA_ENGINEER);
  tester = await makeUser("tester@acceptance.local", TESTER_DISPLAY_NAME, QamsRole.QA_TESTER);
});

describe("Workbook map", () => {
  it("all 13 source sheets are required: a workbook missing one is rejected as malformed", async () => {
    const wb = buildWorkbook();
    const XLSXwb = XLSX.read(wb, { type: "buffer" });
    expect(XLSXwb.SheetNames).toHaveLength(13);

    const missingRtm = buildWorkbook((sheets) => {
      delete sheets.RTM;
    });
    const err = await expectAppError(createImportRun(lead, "missing-rtm.xlsx", missingRtm), 422, "ID_INVALID");
    expect(err.message).toContain("RTM");
  });
});

describe("Seed import", () => {
  it("imports a valid workbook: records in dependency order, IDs preserved, dashboard recomputed", async () => {
    const run = await createImportRun(lead, "valid.xlsx", buildWorkbook());
    expect(run.status).toBe("COMPLETED");
    expect(run.completedAt).not.toBeNull();
    expect(run.sourceFileHash).toMatch(/^[0-9a-f]{64}$/);

    const product = await prisma.product.findUnique({ where: { businessId: "PROD001" } });
    const moduleRow = await prisma.module.findUnique({ where: { businessId: "MOD001" } });
    const feature = await prisma.feature.findUnique({ where: { businessId: "FEAT001" } });
    const requirement = await prisma.requirement.findUnique({ where: { businessId: "REQ001" } });
    const testCase = await prisma.testCase.findUnique({
      where: { businessId: "TC-PROD001-0001" },
      include: { steps: true }
    });
    expect(product).not.toBeNull();
    expect(moduleRow?.productId).toBe(product?.id);
    expect(feature?.moduleId).toBe(moduleRow?.id);
    expect(requirement?.featureId).toBe(feature?.id);
    expect(testCase?.requirementId).toBe(requirement?.id);
    expect(testCase?.steps).toHaveLength(1);

    // One workbook row = one execution covering exactly one case: the covered case and
    // its per-case result land on a single ExecutionTestCase child row.
    const execution = await prisma.testExecution.findUnique({
      where: { businessId: "EXE-0001" },
      include: { cases: true }
    });
    expect(execution?.state).toBe(ExecutionLifecycleState.FINALIZED);
    expect(execution?.cases).toHaveLength(1);
    expect(execution?.cases[0].testCaseId).toBe(testCase?.id);
    expect(execution?.cases[0].result).toBe(ExecutionOutcome.PASS);
    const defect = await prisma.defect.findUnique({ where: { businessId: "BUG-0001" } });
    expect(defect?.status).toBe(DefectLifecycleState.NEW);
    const links = await prisma.requirementTraceLink.findMany();
    expect(links).toHaveLength(1);

    const report = run.reportJson as { dashboard: { products: number; testCases: number } };
    expect(report.dashboard.products).toBe(1);
    expect(report.dashboard.testCases).toBe(1);
  });

  it("imports test cases as Approved per the documented seed-import exception, and says so", async () => {
    const testCase = await prisma.testCase.findUnique({ where: { businessId: "TC-PROD001-0001" } });
    expect(testCase?.lifecycleState).toBe(TestCaseLifecycleState.APPROVED);
    expect(testCase?.authorUserId).toBe(lead.userId);

    const run = await prisma.importRun.findFirst({ where: { status: "COMPLETED" }, orderBy: { createdAt: "desc" } });
    const rows = await prisma.importRowReport.findMany({
      where: { importRunId: run!.id, sourceSheet: "Test Repository", outcome: "CREATED" }
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].details).toContain("Imported as Approved.");

    const report = run!.reportJson as { policyGaps: string[] };
    expect(report.policyGaps.some((gap) => gap.includes("imported as Approved"))).toBe(true);
  });

  it("re-importing the unchanged source creates no duplicates and reports SKIPPED_UNCHANGED", async () => {
    const before = {
      products: await prisma.product.count(),
      testCases: await prisma.testCase.count(),
      executions: await prisma.testExecution.count(),
      defects: await prisma.defect.count()
    };

    const run = await createImportRun(lead, "valid-again.xlsx", buildWorkbook());
    expect(run.status).toBe("COMPLETED");

    const after = {
      products: await prisma.product.count(),
      testCases: await prisma.testCase.count(),
      executions: await prisma.testExecution.count(),
      defects: await prisma.defect.count()
    };
    expect(after).toEqual(before);

    const skipped = await prisma.importRowReport.count({ where: { importRunId: run.id, outcome: "SKIPPED_UNCHANGED" } });
    expect(skipped).toBeGreaterThan(0);
    const created = await prisma.importRowReport.count({ where: { importRunId: run.id, outcome: "CREATED" } });
    expect(created).toBe(0);
  });

  it("changed values are reported RECONCILIATION_REQUIRED and left uncommitted", async () => {
    const renamed = buildWorkbook((sheets) => {
      sheets["Product Master"][1] = ["PROD001", "Alpha Renamed", "1.0", "Active"];
    });
    const run = await createImportRun(lead, "renamed.xlsx", renamed);

    const row = await prisma.importRowReport.findFirst({
      where: { importRunId: run.id, sourceSheet: "Product Master", outcome: "RECONCILIATION_REQUIRED" }
    });
    expect(row).not.toBeNull();
    expect(row?.sourceRow).toBeGreaterThan(0);

    const product = await prisma.product.findUnique({ where: { businessId: "PROD001" } });
    expect(product?.name).toBe("Alpha");
  });

  it("rejects an unknown parent with source row and stable code, with no partial dependent write", async () => {
    const orphaned = buildWorkbook((sheets) => {
      sheets["Module Master"] = [
        ["Module ID", "Product ID", "Module"],
        ["MOD999", "PROD999", "Orphan"]
      ];
    });
    const run = await createImportRun(lead, "orphan.xlsx", orphaned);

    const row = await prisma.importRowReport.findFirst({
      where: { importRunId: run.id, sourceSheet: "Module Master", outcome: "REJECTED" }
    });
    expect(row?.errorCode).toBe("REFERENCE_NOT_FOUND");
    expect(row?.sourceRow).toBe(2);
    expect(await prisma.module.findUnique({ where: { businessId: "MOD999" } })).toBeNull();
  });

  it("rejects an invalid controlled value with a stable code", async () => {
    const badPriority = buildWorkbook((sheets) => {
      sheets["Test Repository"][1] = ["TC-PROD001-0002", "PROD001", "MOD001", "FEAT001", "REQ001", "C1", "S1", "R1", "QA", "Urgent", "Major", "Bad priority", "x", "x", ""];
      sheets["Test Steps"].push(["TC-PROD001-0002", 1, "x", "x"]);
    });
    const run = await createImportRun(lead, "bad-priority.xlsx", badPriority);

    const row = await prisma.importRowReport.findFirst({
      where: { importRunId: run.id, sourceSheet: "Test Repository", outcome: "REJECTED" }
    });
    expect(row?.errorCode).toBe("CONTROLLED_VALUE_INVALID");
    expect(await prisma.testCase.findUnique({ where: { businessId: "TC-PROD001-0002" } })).toBeNull();
  });
});

// Interactive scenarios build their own hierarchy through the domain services rather
// than reusing imported records, so a seed-import regression cannot cascade into them.
let interactive: {
  productId: string;
  moduleId: string;
  featureId: string;
  requirementId: string;
  draftId: string;
  draftVersion: number;
};

describe("Test design", () => {
  beforeAll(async () => {
    const product = await createProduct({ businessId: "PROD002", name: "Beta", versionTag: "1.0", status: "Active" }, lead);
    const moduleRow = await createModule({ businessId: "MOD002", name: "Checkout", productId: product.id }, lead);
    const feature = await createFeature({ businessId: "FEAT002", name: "Payment", moduleId: moduleRow.id }, lead);
    const requirement = await createRequirement({ businessId: "REQ002", statement: "A user can pay", featureId: feature.id }, lead);
    const draft = await createTestCase(
      {
        businessId: "TC-PROD002-0001",
        productId: product.id,
        moduleId: moduleRow.id,
        featureId: feature.id,
        requirementId: requirement.id,
        cycle: "C1",
        sprint: "S1",
        release: "R1",
        environment: "QA",
        priority: "High",
        severity: "Major",
        title: "Pay with card",
        objective: "Verify card payment",
        expectedResult: "Payment succeeds"
      },
      engineer
    );
    const withSteps = await replaceSteps(
      draft.id,
      [{ sequence: 1, action: "Enter card", expectedResult: "Accepted" }],
      draft.version,
      engineer
    );
    interactive = {
      productId: product.id,
      moduleId: moduleRow.id,
      featureId: feature.id,
      requirementId: requirement.id,
      draftId: draft.id,
      draftVersion: withSteps.version
    };
  });

  it("a QA Engineer submits their own valid Draft: state becomes In Review", async () => {
    const submitted = await submitTestCase(interactive.draftId, interactive.draftVersion, engineer);
    expect(submitted.lifecycleState).toBe(TestCaseLifecycleState.IN_REVIEW);
    interactive.draftVersion = submitted.version;
  });

  it("the author cannot approve their own case: 403, no transition", async () => {
    // The author is a QA Engineer, below the approver roles — and even a Senior
    // author is refused on their own case, which is the sharper half of the rule.
    await expectAppError(approveTestCase(interactive.draftId, interactive.draftVersion, engineer), 403, "UNAUTHORIZED");
    const unchanged = await prisma.testCase.findUnique({ where: { id: interactive.draftId } });
    expect(unchanged?.lifecycleState).toBe(TestCaseLifecycleState.IN_REVIEW);
  });

  it("a Senior QA Engineer approves another author's review: Approved, audit event exists", async () => {
    const approved = await approveTestCase(interactive.draftId, interactive.draftVersion, senior);
    expect(approved.lifecycleState).toBe(TestCaseLifecycleState.APPROVED);
    interactive.draftVersion = approved.version;

    const audit = await prisma.auditEvent.findFirst({
      where: { action: "TEST_CASE_APPROVED", entityId: interactive.draftId }
    });
    expect(audit).not.toBeNull();
    expect(audit?.actorId).toBe(senior.userId);
    expect(audit?.requestId).toBe(REQ);
  });

  it("editing an Approved case is rejected; the revision workflow is required", async () => {
    await expectAppError(
      updateTestCaseDraft(interactive.draftId, { title: "Sneaky edit", version: interactive.draftVersion }, engineer),
      422,
      "FORBIDDEN_TRANSITION"
    );
  });
});

let executionId: string;
let executionVersion: number;
let caseA: string; // the interactive Approved case
let caseB: string;
let caseC: string;
let draftCaseId: string;

describe("Execution", () => {
  /** Author + approve one more case so an execution can cover several. */
  async function approvedCase(businessId: string, title: string): Promise<string> {
    const draft = await createTestCase(
      {
        businessId,
        productId: interactive.productId,
        moduleId: interactive.moduleId,
        featureId: interactive.featureId,
        requirementId: interactive.requirementId,
        cycle: "C1",
        sprint: "S1",
        release: "R1",
        environment: "QA",
        priority: "High",
        severity: "Major",
        title,
        objective: `Verify ${title.toLowerCase()}`,
        expectedResult: "It works"
      },
      engineer
    );
    const withSteps = await replaceSteps(
      draft.id,
      [{ sequence: 1, action: "Do the thing", expectedResult: "It worked" }],
      draft.version,
      engineer
    );
    const submitted = await submitTestCase(draft.id, withSteps.version, engineer);
    await approveTestCase(draft.id, submitted.version, senior);
    return draft.id;
  }

  beforeAll(async () => {
    caseA = interactive.draftId;
    caseB = await approvedCase("TC-PROD002-0002", "Pay with voucher");
    caseC = await approvedCase("TC-PROD002-0003", "Pay with saved card");
    // A Draft case for the non-Approved rejection scenario; never submitted.
    const draft = await createTestCase(
      {
        businessId: "TC-PROD002-0004",
        productId: interactive.productId,
        moduleId: interactive.moduleId,
        featureId: interactive.featureId,
        requirementId: interactive.requirementId,
        cycle: "C1",
        sprint: "S1",
        release: "R1",
        environment: "QA",
        priority: "High",
        severity: "Major",
        title: "Pay by invoice",
        objective: "Verify invoice payment",
        expectedResult: "It works"
      },
      engineer
    );
    draftCaseId = draft.id;

    const execution = await createExecution(
      { businessId: "EXE-1001", testCaseIds: [caseA, caseB, caseC], testerId: tester.userId },
      lead
    );
    executionId = execution.id;
    executionVersion = execution.version;
  });

  it("an execution covering N Approved cases is created Planned with one link row per case", async () => {
    const created = await prisma.testExecution.findUnique({
      where: { id: executionId },
      include: { cases: true }
    });
    expect(created?.state).toBe(ExecutionLifecycleState.PLANNED);
    expect(created?.cases.map((row) => row.testCaseId).sort()).toEqual([caseA, caseB, caseC].sort());
  });

  it("creating an execution that includes any non-Approved case is 422; nothing is created", async () => {
    await expectAppError(
      createExecution(
        { businessId: "EXE-1002", testCaseIds: [caseB, draftCaseId], testerId: tester.userId },
        lead
      ),
      422,
      "FORBIDDEN_TRANSITION"
    );
    expect(await prisma.testExecution.findUnique({ where: { businessId: "EXE-1002" } })).toBeNull();
  });

  it("creating an execution with an empty or duplicated case list is 422", async () => {
    await expectAppError(
      createExecution({ businessId: "EXE-1002", testCaseIds: [], testerId: tester.userId }, lead),
      422,
      "ID_INVALID"
    );
    await expectAppError(
      createExecution({ businessId: "EXE-1002", testCaseIds: [caseB, caseB], testerId: tester.userId }, lead),
      422,
      "ID_INVALID"
    );
  });

  it("starting an assigned execution over Approved cases sets In Progress and startedAt", async () => {
    const started = await startExecution(executionId, executionVersion, tester);
    expect(started.state).toBe(ExecutionLifecycleState.IN_PROGRESS);
    expect(started.startedAt).not.toBeNull();
    executionVersion = started.version;
  });

  it("finalizing with a missing, extra, or duplicated case in results[] returns 422 ID_INVALID", async () => {
    const entry = (testCaseId: string) => ({
      testCaseId,
      result: ExecutionOutcome.PASS,
      actualResult: "Fine"
    });

    // Missing: only one of the three covered cases — no partial finalize.
    await expectAppError(
      finalizeExecution(executionId, { version: executionVersion, results: [entry(caseA)] }, tester),
      422,
      "ID_INVALID"
    );
    // Extra: a case this execution does not cover.
    await expectAppError(
      finalizeExecution(
        executionId,
        { version: executionVersion, results: [entry(caseA), entry(caseB), entry(caseC), entry(draftCaseId)] },
        tester
      ),
      422,
      "ID_INVALID"
    );
    // Duplicated: a covered case appearing twice.
    await expectAppError(
      finalizeExecution(
        executionId,
        { version: executionVersion, results: [entry(caseA), entry(caseB), entry(caseB)] },
        tester
      ),
      422,
      "ID_INVALID"
    );
  });

  it("finalizing a failing case without a same-case defect returns 422", async () => {
    await expectAppError(
      finalizeExecution(
        executionId,
        {
          version: executionVersion,
          results: [
            { testCaseId: caseA, result: ExecutionOutcome.FAIL, actualResult: "It broke" },
            { testCaseId: caseB, result: ExecutionOutcome.PASS, actualResult: "Fine" },
            { testCaseId: caseC, result: ExecutionOutcome.PASS, actualResult: "Fine" }
          ]
        },
        tester
      ),
      422
    );
  });

  it("finalizing a Blocked case without a block reason returns 422", async () => {
    await expectAppError(
      finalizeExecution(
        executionId,
        {
          version: executionVersion,
          results: [
            { testCaseId: caseA, result: ExecutionOutcome.PASS, actualResult: "Fine" },
            { testCaseId: caseB, result: ExecutionOutcome.PASS, actualResult: "Fine" },
            { testCaseId: caseC, result: ExecutionOutcome.BLOCKED, actualResult: "Env down" }
          ]
        },
        tester
      ),
      422
    );
  });

  it("mixed per-case outcomes derive the execution result, write per-case rows and history, and may create several defects", async () => {
    const finalized = await finalizeExecution(
      executionId,
      {
        version: executionVersion,
        results: [
          {
            testCaseId: caseA,
            result: ExecutionOutcome.FAIL,
            actualResult: "Card payment errored",
            createDefect: { businessId: "BUG-2001", summary: "Card payment errors out", priority: "High", severity: "Major" }
          },
          {
            testCaseId: caseB,
            result: ExecutionOutcome.FAIL,
            actualResult: "Voucher rejected",
            createDefect: { businessId: "BUG-2002", summary: "Valid voucher rejected" }
          },
          {
            testCaseId: caseC,
            result: ExecutionOutcome.BLOCKED,
            actualResult: "Could not reach the saved-card service",
            blockReason: "Saved-card service was down"
          }
        ]
      },
      tester
    );

    // Derived: Fail beats Blocked beats Pass.
    expect(finalized.state).toBe(ExecutionLifecycleState.FINALIZED);
    expect(finalized.result).toBe(ExecutionOutcome.FAIL);
    expect(finalized.finalizedAt).not.toBeNull();

    const caseRows = await prisma.executionTestCase.findMany({ where: { executionId } });
    const byCase = new Map(caseRows.map((row) => [row.testCaseId, row]));
    expect(byCase.get(caseA)?.result).toBe(ExecutionOutcome.FAIL);
    expect(byCase.get(caseB)?.result).toBe(ExecutionOutcome.FAIL);
    expect(byCase.get(caseC)?.result).toBe(ExecutionOutcome.BLOCKED);
    expect(byCase.get(caseC)?.blockReason).toBe("Saved-card service was down");
    expect(byCase.get(caseA)?.actualResult).toBe("Card payment errored");

    // One append-only history row per covered case.
    const history = await executionHistory(executionId);
    expect(history).toHaveLength(3);
    expect(history.map((row) => row.testCaseId).sort()).toEqual([caseA, caseB, caseC].sort());

    // One finalize request created two defects, each referencing its own failing case,
    // and linked both to this execution.
    const bugOne = await prisma.defect.findUnique({ where: { businessId: "BUG-2001" } });
    const bugTwo = await prisma.defect.findUnique({ where: { businessId: "BUG-2002" } });
    expect(bugOne?.testCaseId).toBe(caseA);
    expect(bugTwo?.testCaseId).toBe(caseB);
    expect(await prisma.defectExecutionLink.count({ where: { executionId } })).toBe(2);

    executionVersion = finalized.version;
  });

  it("a Finalized execution cannot be edited; history is append-only", async () => {
    await expectAppError(
      finalizeExecution(
        executionId,
        {
          version: executionVersion,
          results: [
            { testCaseId: caseA, result: ExecutionOutcome.PASS, actualResult: "Again" },
            { testCaseId: caseB, result: ExecutionOutcome.PASS, actualResult: "Again" },
            { testCaseId: caseC, result: ExecutionOutcome.PASS, actualResult: "Again" }
          ]
        },
        tester
      ),
      422,
      "FORBIDDEN_TRANSITION"
    );
    expect(await executionHistory(executionId)).toHaveLength(3);
  });

  it("a rerun covers only the blocked case and derives Pass when it passes", async () => {
    const rerun = await createExecution(
      { businessId: "EXE-1003", testCaseIds: [caseC], testerId: tester.userId },
      lead
    );
    const started = await startExecution(rerun.id, rerun.version, tester);
    const finalized = await finalizeExecution(
      started.id,
      {
        version: started.version,
        results: [{ testCaseId: caseC, result: ExecutionOutcome.PASS, actualResult: "Saved card charged" }]
      },
      tester
    );
    expect(finalized.result).toBe(ExecutionOutcome.PASS);
    expect(await executionHistory(rerun.id)).toHaveLength(1);
  });
});

describe("Defects", () => {
  it("skipping states to Closed is rejected; the transition table is enforced", async () => {
    const defect = await createDefect(
      { businessId: "BUG-1001", testCaseId: interactive.draftId, summary: "Card declined incorrectly", priority: "High", severity: "Major" },
      tester
    );
    expect(defect.status).toBe(DefectLifecycleState.NEW);

    await expectAppError(
      transitionDefect(
        defect.id,
        { version: defect.version, targetStatus: DefectLifecycleState.CLOSED, closureRationale: "Skipping ahead" },
        senior
      ),
      422,
      "FORBIDDEN_TRANSITION"
    );
    const unchanged = await prisma.defect.findUnique({ where: { id: defect.id } });
    expect(unchanged?.status).toBe(DefectLifecycleState.NEW);
  });
});

describe("Traceability", () => {
  it("a hierarchy-mismatched requirement/test-case link returns 422 HIERARCHY_MISMATCH", async () => {
    // REQ001 belongs to the imported PROD001 chain; the interactive case belongs to PROD002.
    const foreignRequirement = await prisma.requirement.findUnique({ where: { businessId: "REQ001" } });
    await expectAppError(
      createRtmLink({
        requirementId: foreignRequirement!.id,
        testCaseId: interactive.draftId,
        actorId: engineer.userId,
        actorRole: engineer.role,
        requestId: REQ
      }),
      422,
      "HIERARCHY_MISMATCH"
    );
  });
});

describe("Reporting", () => {
  it("the dashboard counts non-retired persisted products and cases only", async () => {
    await createProduct({ businessId: "PROD003", name: "Sunset", versionTag: "0.9", status: "Retired" }, lead);
    const retired = await retireTestCase(
      interactive.draftId,
      { version: interactive.draftVersion, retirementReason: "Superseded by the next release's suite" },
      lead
    );
    expect(retired.lifecycleState).toBe(TestCaseLifecycleState.RETIRED);

    const snapshot = await dashboardSnapshot();
    // Non-retired products: imported PROD001 + interactive PROD002; PROD003 is Retired.
    expect(snapshot.products).toBe(2);
    // Non-retired cases: the imported TC-PROD001-0001 plus the Execution block's
    // TC-PROD002-0002/-0003 (Approved) and TC-PROD002-0004 (Draft); the first
    // interactive case was just retired.
    expect(snapshot.testCases).toBe(4);
    // The metric statements required by business-rules-and-validation.md:37.
    expect(snapshot.executionFinalizedByResult.filters).toContain("FINALIZED");
    expect(snapshot.executionFinalizedByResult.numerator).toBeTruthy();
    expect(snapshot.executionFinalizedByResult.denominator).toBeTruthy();
    expect(snapshot.executionFinalizedByResult.asOfUtc).toBe(snapshot.asOfUtc);
  });
});

describe("Security", () => {
  it("a client-submitted role or lifecycle state never reaches the domain: strict schema rejects it", () => {
    const body = {
      businessId: "TC-PROD002-9999",
      productId: "x",
      moduleId: "x",
      featureId: "x",
      requirementId: "x",
      cycle: "C1",
      sprint: "S1",
      release: "R1",
      environment: "QA",
      priority: "High",
      severity: "Major",
      title: "t",
      objective: "o",
      expectedResult: "e"
    };
    expect(createTestCaseSchema.safeParse({ ...body, lifecycleState: "APPROVED" }).success).toBe(false);
    expect(createTestCaseSchema.safeParse({ ...body, role: "QA_LEAD" }).success).toBe(false);
    expect(createTestCaseSchema.safeParse(body).success).toBe(true);
  });

  it("the effective role is the server-side one: an unauthorized action is 403", async () => {
    // Whatever a client claims, the domain sees only the session-derived actor role.
    await expectAppError(approveTestCase(interactive.draftId, undefined, tester), 403, "UNAUTHORIZED");
  });
});

describe("People", () => {
  it("a non-lead cannot create a user account: 403", async () => {
    await expectAppError(
      createUser(
        { email: "sneak@acceptance.local", displayName: "Sneak", role: QamsRole.QA_LEAD, password: "long-enough-pw" },
        tester
      ),
      403,
      "UNAUTHORIZED"
    );
  });

  it("the QA Lead creates a user: projection only, audited without credential material", async () => {
    const created = await createUser(
      { email: "New.Person@Acceptance.Local", displayName: "New Person", role: QamsRole.QA_TESTER, password: "long-enough-pw" },
      lead
    );
    // The email is normalized, and the response carries exactly the documented projection.
    expect(created.email).toBe("new.person@acceptance.local");
    expect(Object.keys(created).sort()).toEqual(["active", "displayName", "email", "id", "role", "version"].sort());

    const stored = await prisma.user.findUnique({ where: { id: created.id } });
    expect(stored?.passwordHash).toBeTruthy();
    expect(stored?.passwordHash).not.toContain("long-enough-pw");

    const audit = await prisma.auditEvent.findFirst({ where: { action: "USER_CREATED", entityId: created.id } });
    expect(audit?.actorId).toBe(lead.userId);
    expect(JSON.stringify(audit?.beforeAfterJson)).not.toContain("long-enough-pw");
    expect(JSON.stringify(audit?.beforeAfterJson)).not.toContain(stored?.passwordHash ?? "@@never@@");
  });

  it("changing one's own password: wrong current 403, hash rotates, other sessions revoked, no material in the audit", async () => {
    const { changeOwnPassword } = await import("@/domain/auth");
    const { verifyPassword } = await import("@/lib/password");
    const { isSessionRevoked } = await import("@/lib/session");
    const person = await prisma.user.findUnique({ where: { email: "new.person@acceptance.local" } });
    const beforeChange = Date.now() - 1;

    await expectAppError(
      changeOwnPassword(person!.id, { currentPassword: "wrong-password", newPassword: "rotated-pw-999" }, REQ),
      403,
      "UNAUTHORIZED"
    );
    await expectAppError(
      changeOwnPassword(person!.id, { currentPassword: "long-enough-pw", newPassword: "seven77" }, REQ),
      422,
      "ID_INVALID"
    );

    const { issuedAtMs } = await changeOwnPassword(
      person!.id,
      { currentPassword: "long-enough-pw", newPassword: "rotated-pw-999" },
      REQ
    );

    const after = await prisma.user.findUnique({ where: { id: person!.id } });
    expect(verifyPassword("rotated-pw-999", after!.passwordHash)).toBe(true);
    expect(verifyPassword("long-enough-pw", after!.passwordHash)).toBe(false);
    // A session issued before the change is dead; one stamped with the change instant lives.
    expect(isSessionRevoked(beforeChange, after!.sessionsValidFrom)).toBe(true);
    expect(isSessionRevoked(issuedAtMs, after!.sessionsValidFrom)).toBe(false);

    const audit = await prisma.auditEvent.findFirst({
      where: { action: "USER_PASSWORD_CHANGED", entityId: person!.id }
    });
    expect(audit?.actorId).toBe(person!.id);
    const payload = JSON.stringify(audit?.beforeAfterJson);
    expect(payload).not.toContain("rotated-pw-999");
    expect(payload).not.toContain("long-enough-pw");
    expect(payload).not.toContain(after!.passwordHash);
  });

  it("a duplicate email is refused with 409, and a short password with 422", async () => {
    await expectAppError(
      createUser(
        { email: "new.person@acceptance.local", displayName: "Again", role: QamsRole.QA_TESTER, password: "long-enough-pw" },
        lead
      ),
      409,
      "ID_DUPLICATE"
    );
    await expectAppError(
      createUser(
        { email: "short@acceptance.local", displayName: "Short", role: QamsRole.QA_TESTER, password: "seven77" },
        lead
      ),
      422,
      "ID_INVALID"
    );
  });
});

describe("Audit", () => {
  it("import, transition, and role change each emit an append-only event with actor, action, timestamp, request ID", async () => {
    const importEvent = await prisma.auditEvent.findFirst({ where: { action: "IMPORT_COMPLETED" } });
    expect(importEvent?.actorId).toBe(lead.userId);
    expect(importEvent?.occurredAt).toBeInstanceOf(Date);
    expect(importEvent?.requestId).toBeTruthy();

    const transitionEvent = await prisma.auditEvent.findFirst({ where: { action: "EXECUTION_FINALIZED" } });
    expect(transitionEvent).not.toBeNull();

    const target = await prisma.user.findUnique({ where: { email: "engineer@acceptance.local" } });
    await updateUserRole(
      target!.id,
      { role: QamsRole.SENIOR_QA_ENGINEER, version: target!.version, actorId: lead.userId, actorRole: lead.role, requestId: REQ }
    );
    const roleEvent = await prisma.auditEvent.findFirst({ where: { action: "USER_ROLE_UPDATED", entityId: target!.id } });
    expect(roleEvent?.actorId).toBe(lead.userId);
    expect(roleEvent?.requestId).toBe(REQ);
    expect(roleEvent?.occurredAt).toBeInstanceOf(Date);
  });
});

describe("User administration", () => {
  const actorInput = (actor: Actor) => ({ actorId: actor.userId, actorRole: actor.role, requestId: REQ });

  it("the QA Lead updates a profile: email normalized, projection only, audited before/after", async () => {
    const person = await prisma.user.findUnique({ where: { email: "new.person@acceptance.local" } });
    const updated = await updateUserProfile(person!.id, {
      displayName: "Renamed Person",
      email: "Renamed.Person@Acceptance.Local",
      version: person!.version,
      ...actorInput(lead)
    });

    expect(updated.displayName).toBe("Renamed Person");
    expect(updated.email).toBe("renamed.person@acceptance.local");
    expect(updated.version).toBe(person!.version + 1);
    expect(Object.keys(updated).sort()).toEqual(["active", "displayName", "email", "id", "role", "version"].sort());

    const audit = await prisma.auditEvent.findFirst({
      where: { action: "USER_PROFILE_UPDATED", entityId: person!.id }
    });
    expect(audit?.actorId).toBe(lead.userId);
    expect(audit?.requestId).toBe(REQ);
    const payload = audit?.beforeAfterJson as { before: { email: string }; after: { email: string } };
    expect(payload.before.email).toBe("new.person@acceptance.local");
    expect(payload.after.email).toBe("renamed.person@acceptance.local");
  });

  it("a profile update to an email already in use is refused with 409", async () => {
    const person = await prisma.user.findUnique({ where: { email: "renamed.person@acceptance.local" } });
    await expectAppError(
      updateUserProfile(person!.id, { email: "lead@acceptance.local", version: person!.version, ...actorInput(lead) }),
      409,
      "ID_DUPLICATE"
    );
  });

  it("a non-lead cannot update a profile or change activation: 403", async () => {
    const person = await prisma.user.findUnique({ where: { email: "renamed.person@acceptance.local" } });
    await expectAppError(
      updateUserProfile(person!.id, { displayName: "Sneaky", version: person!.version, ...actorInput(tester) }),
      403,
      "UNAUTHORIZED"
    );
    await expectAppError(
      setUserActive(person!.id, { active: false, version: person!.version, ...actorInput(tester) }),
      403,
      "UNAUTHORIZED"
    );
  });

  it("self-deactivation is refused with 422, and no change is written", async () => {
    const self = await prisma.user.findUnique({ where: { id: lead.userId } });
    await expectAppError(
      setUserActive(lead.userId, { active: false, version: self!.version, ...actorInput(lead) }),
      422,
      "FORBIDDEN_TRANSITION"
    );
    const unchanged = await prisma.user.findUnique({ where: { id: lead.userId } });
    expect(unchanged?.active).toBe(true);
    expect(unchanged?.version).toBe(self!.version);
  });

  it("deactivation sets active false, kills existing sessions, and is audited", async () => {
    const { isSessionRevoked } = await import("@/lib/session");
    const person = await prisma.user.findUnique({ where: { email: "renamed.person@acceptance.local" } });
    const beforeDeactivation = Date.now() - 1;

    const updated = await setUserActive(person!.id, {
      active: false,
      version: person!.version,
      ...actorInput(lead)
    });
    expect(updated.active).toBe(false);

    // requireAuth refuses inactive users outright; the sessionsValidFrom stamp
    // additionally keeps pre-deactivation cookies dead across a later reactivation.
    const stored = await prisma.user.findUnique({ where: { id: person!.id } });
    expect(stored?.sessionsValidFrom).not.toBeNull();
    expect(isSessionRevoked(beforeDeactivation, stored!.sessionsValidFrom)).toBe(true);

    const audit = await prisma.auditEvent.findFirst({ where: { action: "USER_DEACTIVATED", entityId: person!.id } });
    expect(audit?.actorId).toBe(lead.userId);
    expect(audit?.beforeAfterJson).toEqual({ before: { active: true }, after: { active: false } });
  });

  it("the last active QA Lead cannot be deactivated: 422", async () => {
    // A second lead makes deactivating the first legal; once only one active lead
    // remains, deactivating them is refused whoever asks.
    const leadTwo = await makeUser("lead2@acceptance.local", "Accept Lead Two", QamsRole.QA_LEAD);

    const firstLead = await prisma.user.findUnique({ where: { id: lead.userId } });
    const deactivated = await setUserActive(lead.userId, {
      active: false,
      version: firstLead!.version,
      ...actorInput(leadTwo)
    });
    expect(deactivated.active).toBe(false);

    const lastLead = await prisma.user.findUnique({ where: { id: leadTwo.userId } });
    await expectAppError(
      setUserActive(leadTwo.userId, { active: false, version: lastLead!.version, ...actorInput(lead) }),
      422,
      "FORBIDDEN_TRANSITION"
    );
    expect((await prisma.user.findUnique({ where: { id: leadTwo.userId } }))?.active).toBe(true);

    // Restore the original lead for the scenarios that follow.
    const inactiveLead = await prisma.user.findUnique({ where: { id: lead.userId } });
    const reactivated = await setUserActive(lead.userId, {
      active: true,
      version: inactiveLead!.version,
      ...actorInput(leadTwo)
    });
    expect(reactivated.active).toBe(true);

    const audit = await prisma.auditEvent.findFirst({ where: { action: "USER_REACTIVATED", entityId: lead.userId } });
    expect(audit?.actorId).toBe(leadTwo.userId);
    expect(audit?.beforeAfterJson).toEqual({ before: { active: false }, after: { active: true } });
  });
});

describe("Controlled values", () => {
  const actorInput = (actor: Actor) => ({ actorId: actor.userId, actorRole: actor.role, requestId: REQ });

  it("a non-lead cannot add a value: 403", async () => {
    await expectAppError(
      createControlledValue({ catalogue: CATALOGUE_PRIORITY, value: "Urgent", ...actorInput(tester) }),
      403,
      "UNAUTHORIZED"
    );
  });

  it("the QA Lead adds a value: created active, trimmed, audited, immediately usable", async () => {
    const created = await createControlledValue({
      catalogue: CATALOGUE_PRIORITY,
      value: "  Urgent  ",
      ...actorInput(lead)
    });
    expect(created.value).toBe("Urgent");
    expect(created.active).toBe(true);

    const audit = await prisma.auditEvent.findFirst({
      where: { action: "CONTROLLED_VALUE_CREATED", entityId: created.id }
    });
    expect(audit?.actorId).toBe(lead.userId);
    expect(audit?.requestId).toBe(REQ);

    // The new value passes the same gate test cases and defects go through.
    await expect(ensureActiveControlledValue(CATALOGUE_PRIORITY, "Urgent", "priority")).resolves.toBeUndefined();
  });

  it("a duplicate within the catalogue is 409; the same value in another catalogue is allowed", async () => {
    await expectAppError(
      createControlledValue({ catalogue: CATALOGUE_PRIORITY, value: "Urgent", ...actorInput(lead) }),
      409,
      "ID_DUPLICATE"
    );
    // Trimming happens before the duplicate check, so a padded duplicate is the same 409.
    await expectAppError(
      createControlledValue({ catalogue: CATALOGUE_PRIORITY, value: " Urgent ", ...actorInput(lead) }),
      409,
      "ID_DUPLICATE"
    );
    // Uniqueness is per catalogue (`(catalogue, value)` — data-model.md:36).
    const severity = await createControlledValue({
      catalogue: CATALOGUE_SEVERITY,
      value: "Urgent",
      ...actorInput(lead)
    });
    expect(severity.catalogue).toBe(CATALOGUE_SEVERITY);
  });
});

describe("Execution reassignment", () => {
  let reassignableId: string;
  let reassignableVersion: number;

  beforeAll(async () => {
    // The imported case is Approved (the interactive one was retired in Reporting).
    const approvedCase = await prisma.testCase.findUnique({ where: { businessId: "TC-PROD001-0001" } });
    const execution = await createExecution(
      { businessId: "EXE-2001", testCaseIds: [approvedCase!.id], testerId: tester.userId },
      lead
    );
    reassignableId = execution.id;
    reassignableVersion = execution.version;
  });

  it("a Planned execution is reassigned to another active tester and audited", async () => {
    const updated = await updateExecution(
      reassignableId,
      { testerId: engineer.userId, version: reassignableVersion },
      lead
    );
    expect(updated.testerId).toBe(engineer.userId);
    expect(updated.state).toBe(ExecutionLifecycleState.PLANNED);
    expect(updated.version).toBe(reassignableVersion + 1);
    reassignableVersion = updated.version;

    const audit = await prisma.auditEvent.findFirst({
      where: { action: "EXECUTION_REASSIGNED", entityId: reassignableId }
    });
    expect(audit?.actorId).toBe(lead.userId);
    expect(audit?.beforeAfterJson).toEqual({
      before: { testerId: tester.userId },
      after: { testerId: engineer.userId }
    });
  });

  it("reassignment to an inactive tester is refused with 422 REFERENCE_INACTIVE", async () => {
    // The person deactivated in the User administration scenarios.
    const inactive = await prisma.user.findUnique({ where: { email: "renamed.person@acceptance.local" } });
    expect(inactive?.active).toBe(false);

    await expectAppError(
      updateExecution(reassignableId, { testerId: inactive!.id, version: reassignableVersion }, lead),
      422,
      "REFERENCE_INACTIVE"
    );
    const unchanged = await prisma.testExecution.findUnique({ where: { id: reassignableId } });
    expect(unchanged?.testerId).toBe(engineer.userId);
  });

  it("a started execution cannot be reassigned: 422 FORBIDDEN_TRANSITION", async () => {
    const started = await startExecution(reassignableId, reassignableVersion, engineer);
    expect(started.state).toBe(ExecutionLifecycleState.IN_PROGRESS);

    await expectAppError(
      updateExecution(reassignableId, { testerId: tester.userId, version: started.version }, lead),
      422,
      "FORBIDDEN_TRANSITION"
    );
    const unchanged = await prisma.testExecution.findUnique({ where: { id: reassignableId } });
    expect(unchanged?.testerId).toBe(engineer.userId);
  });
});

describe("Generated business IDs", () => {
  // docs/testing-and-acceptance.md § Identity: ID-less creates get the next generated
  // ID; generation skips occupied numbers; supplied IDs keep today's behavior.
  // Sequences at this point in the story: executions EXE-0001/-1001/-1003/-2001 (max
  // 2001), defects BUG-0001/-1001/-2001/-2002 (max 2002), test cases TC-PROD001-0001
  // and TC-PROD002-0001..0004 (per-product maxima 1 and 4).

  const testCaseInput = (chain: {
    productId: string;
    moduleId: string;
    featureId: string;
    requirementId: string;
  }, title: string) => ({
    ...chain,
    cycle: "C1",
    sprint: "S1",
    release: "R1",
    environment: "QA",
    priority: "High",
    severity: "Major",
    title,
    objective: `Verify ${title.toLowerCase()}`,
    expectedResult: "It works"
  });

  it("an ID-less execution create gets the next EXE-#### past everything persisted", async () => {
    const created = await createExecution({ testCaseIds: [caseB], testerId: tester.userId }, lead);
    expect(created.businessId).toBe("EXE-2002");
  });

  it("generation skips a number occupied by a supplied ID; the supplied path is unchanged", async () => {
    const supplied = await createExecution(
      { businessId: "EXE-2003", testCaseIds: [caseB], testerId: tester.userId },
      lead
    );
    expect(supplied.businessId).toBe("EXE-2003");

    // The counter would hand out 2003 next — it is taken, so allocation probes to 2004.
    const generated = await createExecution({ testCaseIds: [caseB], testerId: tester.userId }, lead);
    expect(generated.businessId).toBe("EXE-2004");

    // A supplied duplicate still conflicts exactly as before.
    await expectAppError(
      createExecution({ businessId: "EXE-2003", testCaseIds: [caseB], testerId: tester.userId }, lead),
      409,
      "ID_DUPLICATE"
    );
  });

  it("ID-less test-case creates sequence per owning product", async () => {
    const prod002 = {
      productId: interactive.productId,
      moduleId: interactive.moduleId,
      featureId: interactive.featureId,
      requirementId: interactive.requirementId
    };
    const one = await createTestCase(testCaseInput(prod002, "Generated case one"), engineer);
    expect(one.businessId).toBe("TC-PROD002-0005");

    // The imported PROD001 chain sequences independently of PROD002.
    const [product, moduleRow, feature, requirement] = await Promise.all([
      prisma.product.findUnique({ where: { businessId: "PROD001" } }),
      prisma.module.findUnique({ where: { businessId: "MOD001" } }),
      prisma.feature.findUnique({ where: { businessId: "FEAT001" } }),
      prisma.requirement.findUnique({ where: { businessId: "REQ001" } })
    ]);
    const other = await createTestCase(
      testCaseInput(
        { productId: product!.id, moduleId: moduleRow!.id, featureId: feature!.id, requirementId: requirement!.id },
        "Generated case for the imported product"
      ),
      engineer
    );
    expect(other.businessId).toBe("TC-PROD001-0002");

    const two = await createTestCase(testCaseInput(prod002, "Generated case two"), engineer);
    expect(two.businessId).toBe("TC-PROD002-0006");
  });

  it("an ID-less defect create gets the next BUG-####", async () => {
    const defect = await createDefect(
      { testCaseId: caseB, summary: "Raised without an ID" },
      tester
    );
    expect(defect.businessId).toBe("BUG-2003");
  });

  it("one finalize with two ID-less createDefect entries draws two distinct BUG numbers", async () => {
    const execution = await createExecution({ testCaseIds: [caseB, caseC], testerId: tester.userId }, lead);
    const started = await startExecution(execution.id, execution.version, tester);
    const finalized = await finalizeExecution(
      started.id,
      {
        version: started.version,
        results: [
          {
            testCaseId: caseB,
            result: ExecutionOutcome.FAIL,
            actualResult: "Broke one way",
            createDefect: { summary: "Generated defect one" }
          },
          {
            testCaseId: caseC,
            result: ExecutionOutcome.FAIL,
            actualResult: "Broke another way",
            createDefect: { summary: "Generated defect two" }
          }
        ]
      },
      tester
    );
    expect(finalized.result).toBe(ExecutionOutcome.FAIL);

    const first = await prisma.defect.findFirst({ where: { summary: "Generated defect one" } });
    const second = await prisma.defect.findFirst({ where: { summary: "Generated defect two" } });
    expect(first?.businessId).toBe("BUG-2004");
    expect(second?.businessId).toBe("BUG-2005");
    expect(first?.testCaseId).toBe(caseB);
    expect(second?.testCaseId).toBe(caseC);
    expect(await prisma.defectExecutionLink.count({ where: { executionId: execution.id } })).toBe(2);
  });
});
