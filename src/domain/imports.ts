import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import {
  DefectLifecycleState,
  ExecutionLifecycleState,
  ExecutionOutcome,
  Prisma,
  QamsRole,
  TestCaseLifecycleState
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { AppError, type ErrorCode } from "@/lib/errors";
import { appendAudit } from "@/lib/audit";
import { runPaged, type PageRequest } from "@/lib/pagination";
import { BUSINESS_ID_PATTERNS } from "@/lib/business-ids";
import { ensureRole, RoleSets } from "@/lib/rbac";
import { ensureStepSequence } from "@/lib/validation";
import { createFeature, createModule, createProduct, createRequirement } from "@/domain/catalogue";
import { decideCatalogueRow, type RowDecision } from "@/domain/import-decisions";
import {
  SHEET_SPECS,
  extractRows,
  extractSettingsValues,
  findHeaderRow,
  normalizeDefectStatus,
  normalizeExecutionResult,
  parseHistoryDate,
  valuesEqual,
  type ExecutionResultToken,
  type ExtractedRow,
  type HeaderInfo,
  type SheetSpec
} from "@/domain/import-parsing";

const EXPECTED_SHEETS = [
  "Home",
  "Product Master",
  "Module Master",
  "Feature Master",
  "Requirement Master",
  "Test Repository",
  "Test Steps",
  "Test Execution",
  "Execution History",
  "Bug Tracker",
  "RTM",
  "Dashboard",
  "Settings"
];

type Tx = Prisma.TransactionClient;

type RowOutcome = "CREATED" | "SKIPPED_UNCHANGED" | "RECONCILIATION_REQUIRED" | "REJECTED";

type ReportRow = {
  sourceSheet: string;
  sourceRow: number;
  outcome: RowOutcome;
  errorCode?: ErrorCode;
  recordId?: string;
  details?: string;
};

type ParsedSheet = { rows: unknown[][]; header: HeaderInfo };

type StagedBugRef = {
  sourceRow: number;
  executionId: string;
  executionBusinessId: string;
  testCaseId: string;
  bug: string;
};

/**
 * The importing user. Carries the role because the catalogue passes now delegate to
 * the domain services, which enforce `ensureRole` themselves — the import no longer
 * asserts authorization on their behalf.
 */
type ImportActor = { userId: string; role: QamsRole; requestId: string };

type ImportContext = {
  runId: string;
  actor: ImportActor;
  actorId: string;
  requestId: string;
  allReports: ReportRow[];
  stagedBugRefs: StagedBugRef[];
  /** catalogue -> active controlled values, loaded once after the Settings batch commits. */
  activeValues: Map<string, Set<string>>;
};

/**
 * Run a domain-service create inside the batch transaction and record the outcome.
 *
 * The services throw `AppError` where the import must instead *report* the row and
 * carry on — a rejected row is data, not a failed import. Every throw reachable here
 * happens before the service issues a write (role, non-blank, ID format, duplicate),
 * so catching it cannot leave the transaction in an aborted state.
 */
async function createViaService(
  sheet: string,
  sourceRow: number,
  report: ReportRow[],
  create: () => Promise<{ id: string }>
): Promise<void> {
  try {
    const created = await create();
    report.push({ sourceSheet: sheet, sourceRow, outcome: "CREATED", recordId: created.id });
  } catch (error) {
    if (error instanceof AppError) {
      report.push(rejectedRow(sheet, sourceRow, error.code, error.message));
      return;
    }
    throw error;
  }
}

/** Turn a pure `RowDecision` into a report row. Only CREATE needs the caller to act. */
function recordDecision(
  sheet: string,
  sourceRow: number,
  report: ReportRow[],
  decision: RowDecision
): boolean {
  switch (decision.kind) {
    case "REJECTED":
      report.push(rejectedRow(sheet, sourceRow, decision.errorCode, decision.details));
      return false;
    case "SKIPPED_UNCHANGED":
      report.push(skippedRow(sheet, sourceRow, decision.recordId, decision.details));
      return false;
    case "RECONCILIATION_REQUIRED":
      report.push(reconciliationRow(sheet, sourceRow, decision.recordId, decision.details));
      return false;
    case "CREATE":
      return true;
  }
}

function rejectedRow(sheet: string, sourceRow: number, errorCode: ErrorCode, details: string): ReportRow {
  return { sourceSheet: sheet, sourceRow, outcome: "REJECTED", errorCode, details };
}

function skippedRow(sheet: string, sourceRow: number, recordId: string, details?: string): ReportRow {
  return { sourceSheet: sheet, sourceRow, outcome: "SKIPPED_UNCHANGED", recordId, details };
}

function reconciliationRow(sheet: string, sourceRow: number, recordId: string, details: string): ReportRow {
  return {
    sourceSheet: sheet,
    sourceRow,
    outcome: "RECONCILIATION_REQUIRED",
    errorCode: "RECONCILIATION_REQUIRED",
    recordId,
    details
  };
}

function appendDetail(current: string | undefined, addition: string): string {
  return current ? `${current} ${addition}` : addition;
}

async function auditImport(
  tx: Tx,
  ctx: ImportContext,
  action: string,
  entityType: string,
  entityId: string,
  after: unknown
) {
  await appendAudit(tx, {
    actorId: ctx.actorId,
    action,
    entityType,
    entityId,
    requestId: ctx.requestId,
    beforeAfterJson: { after }
  });
}

function sheetRows(workbook: XLSX.WorkBook, sheetName: string): unknown[][] {
  const worksheet = workbook.Sheets[sheetName];
  if (!worksheet) return [];
  return XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, defval: null, blankrows: true });
}

function sheetData(parsed: Map<string, ParsedSheet>, sheet: string): ParsedSheet {
  const data = parsed.get(sheet);
  if (!data) throw new AppError(500, "INTERNAL_ERROR", `Parsed sheet missing: ${sheet}.`);
  return data;
}

/** Report PARTIAL rows as ROW_INCOMPLETE and return the COMPLETE rows; blank rows are ignored. */
function completeRows(
  spec: SheetSpec,
  data: ParsedSheet,
  report: ReportRow[]
): ExtractedRow[] {
  const complete: ExtractedRow[] = [];
  for (const row of extractRows(data.rows, data.header, spec)) {
    if (row.kind === "BLANK") continue;
    if (row.kind === "PARTIAL") {
      report.push(
        rejectedRow(spec.sheet, row.sourceRow, "ROW_INCOMPLETE", "Row is partially populated; required cells are blank.")
      );
      continue;
    }
    complete.push(row);
  }
  return complete;
}

/** Run one dependency-consistent batch atomically: entities + its ImportRowReport rows + audits. */
async function commitBatch(ctx: ImportContext, fn: (tx: Tx) => Promise<ReportRow[]>) {
  const rows = await prisma.$transaction(
    async (tx) => {
      const batchRows = await fn(tx);
      if (batchRows.length > 0) {
        await tx.importRowReport.createMany({
          data: batchRows.map((row) => ({
            importRunId: ctx.runId,
            sourceSheet: row.sourceSheet,
            sourceRow: row.sourceRow,
            outcome: row.outcome,
            errorCode: row.errorCode ?? null,
            recordId: row.recordId ?? null,
            details: row.details ?? null,
            createdBy: ctx.actorId
          }))
        });
      }
      return batchRows;
    },
    { timeout: 60_000 }
  );
  ctx.allReports.push(...rows);
}

function activeResultMatches(ctx: ImportContext, token: ExecutionResultToken): boolean {
  const values = ctx.activeValues.get("Result");
  if (!values) return false;
  for (const value of values) {
    if (value.toUpperCase() === token) return true;
  }
  return false;
}

async function importSettings(ctx: ImportContext, data: ParsedSheet) {
  await commitBatch(ctx, async (tx) => {
    const report: ReportRow[] = [];
    const sheet = SHEET_SPECS.settings.sheet;
    const triples = extractSettingsValues(data.rows, data.header);
    const existing = await tx.controlledValue.findMany();
    const byKey = new Map(existing.map((cv) => [`${cv.catalogue}\u0000${cv.value}`, cv]));
    const createdByKey = new Map<string, string>();

    for (const triple of triples) {
      const key = `${triple.catalogue}\u0000${triple.value}`;
      const current = byKey.get(key);
      if (current) {
        if (current.active) {
          report.push(skippedRow(sheet, triple.sourceRow, current.id, `${triple.catalogue} value already configured.`));
        } else {
          report.push(
            reconciliationRow(
              sheet,
              triple.sourceRow,
              current.id,
              `${triple.catalogue} value "${triple.value}" exists but is inactive; reactivation requires QA Lead reconciliation.`
            )
          );
        }
        continue;
      }
      const createdId = createdByKey.get(key);
      if (createdId) {
        report.push(skippedRow(sheet, triple.sourceRow, createdId, "Duplicate of a value created earlier in this import."));
        continue;
      }
      const created = await tx.controlledValue.create({
        data: {
          catalogue: triple.catalogue,
          value: triple.value,
          active: true,
          createdBy: ctx.actorId,
          updatedBy: ctx.actorId
        }
      });
      createdByKey.set(key, created.id);
      await auditImport(tx, ctx, "CONTROLLED_VALUE_IMPORTED", "ControlledValue", created.id, created);
      report.push({ sourceSheet: sheet, sourceRow: triple.sourceRow, outcome: "CREATED", recordId: created.id });
    }
    return report;
  });

  const active = await prisma.controlledValue.findMany({ where: { active: true } });
  ctx.activeValues = new Map();
  for (const cv of active) {
    const set = ctx.activeValues.get(cv.catalogue) ?? new Set<string>();
    set.add(cv.value);
    ctx.activeValues.set(cv.catalogue, set);
  }
}

async function importProducts(ctx: ImportContext, data: ParsedSheet) {
  const spec = SHEET_SPECS.productMaster;
  await commitBatch(ctx, async (tx) => {
    const report: ReportRow[] = [];
    const rows = completeRows(spec, data, report);
    const byBiz = new Map((await tx.product.findMany()).map((p) => [p.businessId, p]));
    const seen = new Set<string>();

    for (const row of rows) {
      const businessId = row.values["Product ID"];
      const current = byBiz.get(businessId);
      const decision = decideCatalogueRow({
        entityLabel: "Product",
        businessId,
        pattern: BUSINESS_ID_PATTERNS.product,
        patternLabel: "PROD###",
        alreadySeenInSheet: seen.has(businessId),
        existing: current
          ? {
              id: current.id,
              unchanged:
                valuesEqual(current.name, row.values["Product"]) &&
                valuesEqual(current.versionTag, row.values["Version"]) &&
                valuesEqual(current.status, row.values["Status"])
            }
          : null
      });
      seen.add(businessId);
      if (!recordDecision(spec.sheet, row.sourceRow, report, decision)) continue;

      await createViaService(spec.sheet, row.sourceRow, report, () =>
        createProduct(
          {
            businessId,
            name: row.values["Product"],
            versionTag: row.values["Version"],
            status: row.values["Status"]
          },
          ctx.actor,
          tx
        )
      );
    }
    return report;
  });
}

async function importModules(ctx: ImportContext, data: ParsedSheet) {
  const spec = SHEET_SPECS.moduleMaster;
  await commitBatch(ctx, async (tx) => {
    const report: ReportRow[] = [];
    const rows = completeRows(spec, data, report);
    const products = new Map((await tx.product.findMany()).map((p) => [p.businessId, p]));
    const existing = new Map((await tx.module.findMany()).map((m) => [m.businessId, m]));
    const seen = new Set<string>();

    for (const row of rows) {
      const businessId = row.values["Module ID"];
      const parentBusinessId = row.values["Product ID"];
      const parent = products.get(parentBusinessId);
      const current = existing.get(businessId);
      const decision = decideCatalogueRow({
        entityLabel: "Module",
        businessId,
        pattern: BUSINESS_ID_PATTERNS.module,
        patternLabel: "MOD###",
        alreadySeenInSheet: seen.has(businessId),
        missingParent: parent ? null : { label: "Product", businessId: parentBusinessId },
        existing:
          current && parent
            ? {
                id: current.id,
                unchanged:
                  valuesEqual(current.name, row.values["Module"]) && current.productId === parent.id
              }
            : current
              ? { id: current.id, unchanged: false }
              : null
      });
      seen.add(businessId);
      if (!recordDecision(spec.sheet, row.sourceRow, report, decision)) continue;

      await createViaService(spec.sheet, row.sourceRow, report, () =>
        createModule(
          { businessId, name: row.values["Module"], productId: parent!.id },
          ctx.actor,
          tx
        )
      );
    }
    return report;
  });
}

async function importFeatures(ctx: ImportContext, data: ParsedSheet) {
  const spec = SHEET_SPECS.featureMaster;
  await commitBatch(ctx, async (tx) => {
    const report: ReportRow[] = [];
    const rows = completeRows(spec, data, report);
    const modules = new Map((await tx.module.findMany()).map((m) => [m.businessId, m]));
    const existing = new Map((await tx.feature.findMany()).map((f) => [f.businessId, f]));
    const seen = new Set<string>();

    for (const row of rows) {
      const businessId = row.values["Feature ID"];
      const parentBusinessId = row.values["Module ID"];
      const parent = modules.get(parentBusinessId);
      const current = existing.get(businessId);
      const decision = decideCatalogueRow({
        entityLabel: "Feature",
        businessId,
        pattern: BUSINESS_ID_PATTERNS.feature,
        patternLabel: "FEAT###",
        alreadySeenInSheet: seen.has(businessId),
        missingParent: parent ? null : { label: "Module", businessId: parentBusinessId },
        existing:
          current && parent
            ? {
                id: current.id,
                unchanged:
                  valuesEqual(current.name, row.values["Feature"]) && current.moduleId === parent.id
              }
            : current
              ? { id: current.id, unchanged: false }
              : null
      });
      seen.add(businessId);
      if (!recordDecision(spec.sheet, row.sourceRow, report, decision)) continue;

      await createViaService(spec.sheet, row.sourceRow, report, () =>
        createFeature({ businessId, name: row.values["Feature"], moduleId: parent!.id }, ctx.actor, tx)
      );
    }
    return report;
  });
}

async function importRequirements(ctx: ImportContext, data: ParsedSheet) {
  const spec = SHEET_SPECS.requirementMaster;
  await commitBatch(ctx, async (tx) => {
    const report: ReportRow[] = [];
    const rows = completeRows(spec, data, report);
    const features = new Map((await tx.feature.findMany()).map((f) => [f.businessId, f]));
    const existing = new Map((await tx.requirement.findMany()).map((r) => [r.businessId, r]));
    const seen = new Set<string>();

    for (const row of rows) {
      const businessId = row.values["Requirement ID"];
      const parentBusinessId = row.values["Feature ID"];
      const parent = features.get(parentBusinessId);
      const current = existing.get(businessId);
      const decision = decideCatalogueRow({
        entityLabel: "Requirement",
        businessId,
        pattern: BUSINESS_ID_PATTERNS.requirement,
        patternLabel: "REQ###",
        alreadySeenInSheet: seen.has(businessId),
        missingParent: parent ? null : { label: "Feature", businessId: parentBusinessId },
        existing:
          current && parent
            ? {
                id: current.id,
                unchanged:
                  valuesEqual(current.statement, row.values["Requirement"]) &&
                  current.featureId === parent.id
              }
            : current
              ? { id: current.id, unchanged: false }
              : null
      });
      seen.add(businessId);
      if (!recordDecision(spec.sheet, row.sourceRow, report, decision)) continue;

      await createViaService(spec.sheet, row.sourceRow, report, () =>
        createRequirement(
          { businessId, statement: row.values["Requirement"], featureId: parent!.id },
          ctx.actor,
          tx
        )
      );
    }
    return report;
  });
}


type CaseState =
  | { kind: "created"; id: string; reportRow: ReportRow; hasStepRows: boolean }
  | { kind: "existing"; id: string }
  | { kind: "rejected" };

async function importTestCasesAndSteps(ctx: ImportContext, caseData: ParsedSheet, stepData: ParsedSheet) {
  const caseSpec = SHEET_SPECS.testRepository;
  const stepSpec = SHEET_SPECS.testSteps;

  await commitBatch(ctx, async (tx) => {
    const report: ReportRow[] = [];
    const caseRows = completeRows(caseSpec, caseData, report);
    const stepRows = completeRows(stepSpec, stepData, report);

    const [productList, moduleList, featureList, requirementList, tcList, stepList] = await Promise.all([
      tx.product.findMany(),
      tx.module.findMany(),
      tx.feature.findMany(),
      tx.requirement.findMany(),
      tx.testCase.findMany(),
      tx.testStep.findMany()
    ]);
    const productByBiz = new Map(productList.map((p) => [p.businessId, p]));
    const moduleByBiz = new Map(moduleList.map((m) => [m.businessId, m]));
    const featureByBiz = new Map(featureList.map((f) => [f.businessId, f]));
    const requirementByBiz = new Map(requirementList.map((r) => [r.businessId, r]));
    const tcByBiz = new Map(tcList.map((t) => [t.businessId, t]));
    const stepsByCase = new Map<string, typeof stepList>();
    for (const step of stepList) {
      const list = stepsByCase.get(step.testCaseId) ?? [];
      list.push(step);
      stepsByCase.set(step.testCaseId, list);
    }

    const caseState = new Map<string, CaseState>();

    for (const row of caseRows) {
      const v = row.values;
      const businessId = v["TC ID"];
      if (!BUSINESS_ID_PATTERNS.testCase.test(businessId)) {
        report.push(rejectedRow(caseSpec.sheet, row.sourceRow, "ID_INVALID", `TC ID "${businessId}" must match TC-<PRODUCT>-####.`));
        continue;
      }
      if (caseState.has(businessId)) {
        report.push(rejectedRow(caseSpec.sheet, row.sourceRow, "ID_DUPLICATE", `Duplicate TC ID "${businessId}" in sheet.`));
        continue;
      }

      if (!ctx.activeValues.get("Priority")?.has(v["Priority"])) {
        report.push(rejectedRow(caseSpec.sheet, row.sourceRow, "CONTROLLED_VALUE_INVALID", `Priority "${v["Priority"]}" is not an active configured value.`));
        caseState.set(businessId, { kind: "rejected" });
        continue;
      }
      if (!ctx.activeValues.get("Severity")?.has(v["Severity"])) {
        report.push(rejectedRow(caseSpec.sheet, row.sourceRow, "CONTROLLED_VALUE_INVALID", `Severity "${v["Severity"]}" is not an active configured value.`));
        caseState.set(businessId, { kind: "rejected" });
        continue;
      }

      const product = productByBiz.get(v["Product ID"]);
      const moduleRec = moduleByBiz.get(v["Module ID"]);
      const feature = featureByBiz.get(v["Feature ID"]);
      const requirement = requirementByBiz.get(v["Requirement ID"]);
      const missing = [
        product ? null : `Product "${v["Product ID"]}"`,
        moduleRec ? null : `Module "${v["Module ID"]}"`,
        feature ? null : `Feature "${v["Feature ID"]}"`,
        requirement ? null : `Requirement "${v["Requirement ID"]}"`
      ].filter((m): m is string => m !== null);
      if (!product || !moduleRec || !feature || !requirement) {
        report.push(rejectedRow(caseSpec.sheet, row.sourceRow, "REFERENCE_NOT_FOUND", `${missing.join(", ")} not found.`));
        caseState.set(businessId, { kind: "rejected" });
        continue;
      }
      if (requirement.featureId !== feature.id || feature.moduleId !== moduleRec.id || moduleRec.productId !== product.id) {
        report.push(rejectedRow(caseSpec.sheet, row.sourceRow, "HIERARCHY_MISMATCH", "Product, Module, Feature, and Requirement do not form one chain."));
        caseState.set(businessId, { kind: "rejected" });
        continue;
      }

      const current = tcByBiz.get(businessId);
      if (current) {
        const same =
          current.productId === product.id &&
          current.moduleId === moduleRec.id &&
          current.featureId === feature.id &&
          current.requirementId === requirement.id &&
          valuesEqual(current.cycle, v["Cycle"]) &&
          valuesEqual(current.sprint, v["Sprint"]) &&
          valuesEqual(current.release, v["Release"]) &&
          valuesEqual(current.environment, v["Environment"]) &&
          valuesEqual(current.priority, v["Priority"]) &&
          valuesEqual(current.severity, v["Severity"]) &&
          valuesEqual(current.title, v["Title"]) &&
          valuesEqual(current.objective, v["Objective"]) &&
          valuesEqual(current.expectedResult, v["Expected Result"]);
        report.push(
          same
            ? skippedRow(caseSpec.sheet, row.sourceRow, current.id)
            : reconciliationRow(caseSpec.sheet, row.sourceRow, current.id, `Test case "${businessId}" exists with different values; automatic overwrite is not permitted.`)
        );
        caseState.set(businessId, { kind: "existing", id: current.id });
        continue;
      }

      const created = await tx.testCase.create({
        data: {
          businessId,
          productId: product.id,
          moduleId: moduleRec.id,
          featureId: feature.id,
          requirementId: requirement.id,
          cycle: v["Cycle"],
          sprint: v["Sprint"],
          release: v["Release"],
          environment: v["Environment"],
          priority: v["Priority"],
          severity: v["Severity"],
          title: v["Title"],
          objective: v["Objective"],
          expectedResult: v["Expected Result"],
          lifecycleState: TestCaseLifecycleState.APPROVED,
          authorUserId: ctx.actorId,
          createdBy: ctx.actorId,
          updatedBy: ctx.actorId
        }
      });
      await auditImport(tx, ctx, "TEST_CASE_IMPORTED", "TestCase", created.id, created);
      const reportRow: ReportRow = {
        sourceSheet: caseSpec.sheet,
        sourceRow: row.sourceRow,
        outcome: "CREATED",
        recordId: created.id,
        details: `Imported as Approved. Execution Status preserved: "${v["Execution Status"]}" (legacy summary; no execution created).`
      };
      report.push(reportRow);
      caseState.set(businessId, { kind: "created", id: created.id, reportRow, hasStepRows: false });
    }

    // Steps, grouped by TC ID.
    const groups = new Map<string, ExtractedRow[]>();
    for (const row of stepRows) {
      const list = groups.get(row.values["TC ID"]) ?? [];
      list.push(row);
      groups.set(row.values["TC ID"], list);
    }

    for (const [tcId, group] of groups) {
      let state = caseState.get(tcId);
      if (!state) {
        const dbCase = tcByBiz.get(tcId);
        state = dbCase ? { kind: "existing", id: dbCase.id } : undefined;
      }
      if (!state || state.kind === "rejected") {
        for (const row of group) {
          report.push(rejectedRow(stepSpec.sheet, row.sourceRow, "REFERENCE_NOT_FOUND", `Test case "${tcId}" was not found or was rejected in this import.`));
        }
        continue;
      }

      if (state.kind === "existing") {
        const existingSteps = stepsByCase.get(state.id) ?? [];
        for (const row of group) {
          const sequence = Number(row.values["Step"]);
          if (!Number.isInteger(sequence) || sequence < 1) {
            report.push(rejectedRow(stepSpec.sheet, row.sourceRow, "ID_INVALID", `Step "${row.values["Step"]}" is not a positive integer.`));
            continue;
          }
          const match = existingSteps.find(
            (s) =>
              s.sequence === sequence &&
              valuesEqual(s.action, row.values["Action"]) &&
              valuesEqual(s.expectedResult, row.values["Expected"])
          );
          report.push(
            match
              ? skippedRow(stepSpec.sheet, row.sourceRow, match.id)
              : reconciliationRow(stepSpec.sheet, row.sourceRow, state.id, `Steps of existing test case "${tcId}" differ from the source; existing cases are never rewritten by import.`)
          );
        }
        continue;
      }

      // Newly created case: validate the whole step set as one unit.
      state.hasStepRows = true;
      const parsedSteps = group.map((row) => ({ row, sequence: Number(row.values["Step"]) }));
      let ok = parsedSteps.every((s) => Number.isInteger(s.sequence) && s.sequence >= 1);
      if (ok) {
        try {
          ensureStepSequence(parsedSteps);
        } catch {
          ok = false;
        }
      }
      if (!ok) {
        for (const s of parsedSteps) {
          report.push(rejectedRow(stepSpec.sheet, s.row.sourceRow, "ID_INVALID", `Step set for "${tcId}" is malformed (sequence must be consecutive 1..n); no steps were written.`));
        }
        state.reportRow.details = appendDetail(state.reportRow.details, "Step set rejected (malformed sequence); case created without steps.");
        continue;
      }
      for (const s of [...parsedSteps].sort((a, b) => a.sequence - b.sequence)) {
        const created = await tx.testStep.create({
          data: {
            testCaseId: state.id,
            sequence: s.sequence,
            action: s.row.values["Action"],
            expectedResult: s.row.values["Expected"],
            createdBy: ctx.actorId,
            updatedBy: ctx.actorId
          }
        });
        await auditImport(tx, ctx, "TEST_STEP_IMPORTED", "TestStep", created.id, created);
        report.push({ sourceSheet: stepSpec.sheet, sourceRow: s.row.sourceRow, outcome: "CREATED", recordId: created.id });
      }
    }

    for (const state of caseState.values()) {
      if (state.kind === "created" && !state.hasStepRows) {
        state.reportRow.details = appendDetail(state.reportRow.details, "Created without steps (source has no step rows for this case).");
      }
    }

    return report;
  });
}

async function importExecutions(ctx: ImportContext, data: ParsedSheet) {
  const spec = SHEET_SPECS.testExecution;
  await commitBatch(ctx, async (tx) => {
    const report: ReportRow[] = [];
    const rows = completeRows(spec, data, report);
    const [tcList, userList, exeList] = await Promise.all([
      tx.testCase.findMany(),
      tx.user.findMany(),
      // The covered case moved to the ExecutionTestCase child rows; the sheet format is
      // unchanged (one row = one execution = one TC ID per `docs/excel-source-map.md`),
      // so every imported execution has exactly one child row to reconcile against.
      tx.testExecution.findMany({ include: { cases: true } })
    ]);
    const tcByBiz = new Map(tcList.map((t) => [t.businessId, t]));
    const exeByBiz = new Map(exeList.map((e) => [e.businessId, e]));
    const seen = new Set<string>();
    const importedAt = new Date();

    for (const row of rows) {
      const v = row.values;
      const businessId = v["Execution ID"];
      if (!BUSINESS_ID_PATTERNS.execution.test(businessId)) {
        report.push(rejectedRow(spec.sheet, row.sourceRow, "ID_INVALID", `Execution ID "${businessId}" must match EXE-####.`));
        continue;
      }
      if (seen.has(businessId)) {
        report.push(rejectedRow(spec.sheet, row.sourceRow, "ID_DUPLICATE", `Duplicate Execution ID "${businessId}" in sheet.`));
        continue;
      }
      seen.add(businessId);

      const testCase = tcByBiz.get(v["TC ID"]);
      if (!testCase) {
        report.push(rejectedRow(spec.sheet, row.sourceRow, "REFERENCE_NOT_FOUND", `Test case "${v["TC ID"]}" was not found.`));
        continue;
      }
      if (testCase.lifecycleState !== TestCaseLifecycleState.APPROVED) {
        report.push(rejectedRow(spec.sheet, row.sourceRow, "FORBIDDEN_TRANSITION", `Execution requires an Approved test case; "${v["TC ID"]}" is ${testCase.lifecycleState}.`));
        continue;
      }

      const testerText = v["Tester"];
      let candidates = userList.filter((u) => u.displayName.trim() === testerText);
      if (candidates.length === 0) {
        candidates = userList.filter((u) => u.email.toLowerCase() === testerText.toLowerCase());
      }
      if (candidates.length === 0) {
        report.push(rejectedRow(spec.sheet, row.sourceRow, "REFERENCE_NOT_FOUND", `Tester "${testerText}" does not match any user; provision the user and re-import.`));
        continue;
      }
      if (candidates.length > 1) {
        report.push(rejectedRow(spec.sheet, row.sourceRow, "REFERENCE_NOT_FOUND", `Tester "${testerText}" is ambiguous (multiple users share this name); provision a unique user and re-import.`));
        continue;
      }
      const tester = candidates[0];
      if (!tester.active) {
        report.push(rejectedRow(spec.sheet, row.sourceRow, "REFERENCE_INACTIVE", `Tester "${testerText}" is inactive.`));
        continue;
      }

      const token = normalizeExecutionResult(v["Result"]);
      if (token === "INVALID" || (token !== null && !activeResultMatches(ctx, token))) {
        report.push(rejectedRow(spec.sheet, row.sourceRow, "CONTROLLED_VALUE_INVALID", `Result "${v["Result"]}" is not an active configured Result value.`));
        continue;
      }
      const result: ExecutionOutcome | null = token === null ? null : ExecutionOutcome[token];
      const state = result === null ? ExecutionLifecycleState.PLANNED : ExecutionLifecycleState.FINALIZED;

      const current = exeByBiz.get(businessId);
      if (current) {
        const same =
          current.cases.length === 1 &&
          current.cases[0].testCaseId === testCase.id &&
          current.testerId === tester.id &&
          current.state === state &&
          (current.result ?? null) === result;
        if (same) {
          report.push(skippedRow(spec.sheet, row.sourceRow, current.id));
          if (v["Bug"]) {
            ctx.stagedBugRefs.push({
              sourceRow: row.sourceRow,
              executionId: current.id,
              executionBusinessId: businessId,
              testCaseId: testCase.id,
              bug: v["Bug"]
            });
          }
        } else {
          report.push(reconciliationRow(spec.sheet, row.sourceRow, current.id, `Execution "${businessId}" exists with different values; automatic overwrite is not permitted.`));
        }
        continue;
      }

      // One workbook row = one execution covering exactly one case, so the per-case
      // result mirrors the execution-level one on the single child row. The sheet has
      // no actual-result column; it stays null per the source map.
      const created = await tx.testExecution.create({
        data: {
          businessId,
          testerId: tester.id,
          state,
          result,
          finalizedAt: result === null ? null : importedAt,
          createdBy: ctx.actorId,
          updatedBy: ctx.actorId,
          cases: {
            create: {
              testCaseId: testCase.id,
              result,
              createdBy: ctx.actorId,
              updatedBy: ctx.actorId
            }
          }
        }
      });
      await auditImport(tx, ctx, "EXECUTION_IMPORTED", "Execution", created.id, created);
      report.push({ sourceSheet: spec.sheet, sourceRow: row.sourceRow, outcome: "CREATED", recordId: created.id });
      if (v["Bug"]) {
        ctx.stagedBugRefs.push({
          sourceRow: row.sourceRow,
          executionId: created.id,
          executionBusinessId: businessId,
          testCaseId: testCase.id,
          bug: v["Bug"]
        });
      }
    }
    return report;
  });
}

async function importExecutionHistory(ctx: ImportContext, data: ParsedSheet) {
  const spec = SHEET_SPECS.executionHistory;
  await commitBatch(ctx, async (tx) => {
    const report: ReportRow[] = [];
    const rows = completeRows(spec, data, report);
    const [exeList, tcList, historyList] = await Promise.all([
      tx.testExecution.findMany({ include: { cases: true } }),
      tx.testCase.findMany(),
      tx.executionHistory.findMany()
    ]);
    const exeByBiz = new Map(exeList.map((e) => [e.businessId, e]));
    const tcByBiz = new Map(tcList.map((t) => [t.businessId, t]));
    const existing = historyList.map((h) => ({
      id: h.id,
      executionId: h.executionId,
      testCaseId: h.testCaseId,
      result: h.result as string,
      occurredAtMs: h.occurredAt.getTime()
    }));

    for (const row of rows) {
      const v = row.values;
      const execution = exeByBiz.get(v["Execution ID"]);
      if (!execution) {
        report.push(rejectedRow(spec.sheet, row.sourceRow, "REFERENCE_NOT_FOUND", `Execution "${v["Execution ID"]}" was not found; history imports only for a matching execution.`));
        continue;
      }
      const testCase = tcByBiz.get(v["TC ID"]);
      if (!testCase) {
        report.push(rejectedRow(spec.sheet, row.sourceRow, "REFERENCE_NOT_FOUND", `Test case "${v["TC ID"]}" was not found.`));
        continue;
      }
      // A history row must reference a case belonging to its execution
      // (`docs/data-model.md:47`).
      if (!execution.cases.some((coveredCase) => coveredCase.testCaseId === testCase.id)) {
        report.push(rejectedRow(spec.sheet, row.sourceRow, "HIERARCHY_MISMATCH", `Execution "${v["Execution ID"]}" does not cover test case "${v["TC ID"]}".`));
        continue;
      }
      const token = normalizeExecutionResult(v["Result"]);
      if (token === null || token === "INVALID" || !activeResultMatches(ctx, token)) {
        report.push(rejectedRow(spec.sheet, row.sourceRow, "CONTROLLED_VALUE_INVALID", `Result "${v["Result"]}" is not an active configured Result value.`));
        continue;
      }
      const occurredAt = parseHistoryDate(v["Date"]);
      if (!occurredAt) {
        report.push(rejectedRow(spec.sheet, row.sourceRow, "ID_INVALID", `Date "${v["Date"]}" could not be parsed as a date.`));
        continue;
      }

      const result = ExecutionOutcome[token];
      const match = existing.find(
        (h) =>
          h.executionId === execution.id &&
          h.testCaseId === testCase.id &&
          h.result === result &&
          h.occurredAtMs === occurredAt.getTime()
      );
      if (match) {
        report.push(skippedRow(spec.sheet, row.sourceRow, match.id));
        continue;
      }
      const created = await tx.executionHistory.create({
        data: {
          executionId: execution.id,
          testCaseId: testCase.id,
          result,
          occurredAt,
          createdBy: ctx.actorId
        }
      });
      existing.push({
        id: created.id,
        executionId: execution.id,
        testCaseId: testCase.id,
        result,
        occurredAtMs: occurredAt.getTime()
      });
      await auditImport(tx, ctx, "EXECUTION_HISTORY_IMPORTED", "ExecutionHistory", created.id, created);
      report.push({ sourceSheet: spec.sheet, sourceRow: row.sourceRow, outcome: "CREATED", recordId: created.id });
    }
    return report;
  });
}

async function importDefects(ctx: ImportContext, data: ParsedSheet) {
  const spec = SHEET_SPECS.bugTracker;
  await commitBatch(ctx, async (tx) => {
    const report: ReportRow[] = [];
    const rows = completeRows(spec, data, report);
    const [tcList, defectList] = await Promise.all([tx.testCase.findMany(), tx.defect.findMany()]);
    const tcByBiz = new Map(tcList.map((t) => [t.businessId, t]));
    const defectByBiz = new Map(defectList.map((d) => [d.businessId, d]));
    const seen = new Set<string>();

    for (const row of rows) {
      const v = row.values;
      const businessId = v["Bug ID"];
      if (!BUSINESS_ID_PATTERNS.defect.test(businessId)) {
        report.push(rejectedRow(spec.sheet, row.sourceRow, "ID_INVALID", `Bug ID "${businessId}" must match BUG-####.`));
        continue;
      }
      if (seen.has(businessId)) {
        report.push(rejectedRow(spec.sheet, row.sourceRow, "ID_DUPLICATE", `Duplicate Bug ID "${businessId}" in sheet.`));
        continue;
      }
      seen.add(businessId);
      const testCase = tcByBiz.get(v["TC ID"]);
      if (!testCase) {
        report.push(rejectedRow(spec.sheet, row.sourceRow, "REFERENCE_NOT_FOUND", `Test case "${v["TC ID"]}" was not found.`));
        continue;
      }
      const statusToken = normalizeDefectStatus(v["Status"]);
      if (!statusToken) {
        report.push(rejectedRow(spec.sheet, row.sourceRow, "CONTROLLED_VALUE_INVALID", `Status "${v["Status"]}" does not match the defect lifecycle (New/Triaged/In Progress/Resolved/Closed).`));
        continue;
      }
      const status = DefectLifecycleState[statusToken];

      const current = defectByBiz.get(businessId);
      if (current) {
        const same =
          current.testCaseId === testCase.id &&
          valuesEqual(current.summary, v["Summary"]) &&
          current.status === status;
        report.push(
          same
            ? skippedRow(spec.sheet, row.sourceRow, current.id)
            : reconciliationRow(spec.sheet, row.sourceRow, current.id, `Defect "${businessId}" exists with different values; automatic overwrite is not permitted.`)
        );
        continue;
      }

      const created = await tx.defect.create({
        data: {
          businessId,
          testCaseId: testCase.id,
          summary: v["Summary"],
          status,
          priority: "",
          severity: "",
          createdBy: ctx.actorId,
          updatedBy: ctx.actorId
        }
      });
      await auditImport(tx, ctx, "DEFECT_IMPORTED", "Defect", created.id, created);
      const details =
        status === DefectLifecycleState.NEW
          ? "Source sheet has no priority/severity columns; imported blank per source map."
          : `Source sheet has no priority/severity columns; imported blank per source map. Status "${status}" normally requires priority and severity — QA Lead follow-up required.`;
      report.push({ sourceSheet: spec.sheet, sourceRow: row.sourceRow, outcome: "CREATED", recordId: created.id, details });
    }
    return report;
  });
}

async function resolveBugLinks(ctx: ImportContext) {
  if (ctx.stagedBugRefs.length === 0) return;
  const sheet = SHEET_SPECS.testExecution.sheet;
  await commitBatch(ctx, async (tx) => {
    const report: ReportRow[] = [];
    const [defectList, linkList] = await Promise.all([tx.defect.findMany(), tx.defectExecutionLink.findMany()]);
    const defectByBiz = new Map(defectList.map((d) => [d.businessId, d]));
    const linkKeys = new Set(linkList.map((l) => `${l.defectId}\u0000${l.executionId}`));

    for (const ref of ctx.stagedBugRefs) {
      const defect = defectByBiz.get(ref.bug);
      if (!defect) {
        report.push(rejectedRow(sheet, ref.sourceRow, "REFERENCE_NOT_FOUND", `Bug "${ref.bug}" referenced by execution "${ref.executionBusinessId}" was not found; execution was still imported.`));
        continue;
      }
      if (defect.testCaseId !== ref.testCaseId) {
        report.push(rejectedRow(sheet, ref.sourceRow, "HIERARCHY_MISMATCH", `Bug "${ref.bug}" references a different test case than execution "${ref.executionBusinessId}"; link not created, execution was still imported.`));
        continue;
      }
      const key = `${defect.id}\u0000${ref.executionId}`;
      if (linkKeys.has(key)) {
        report.push(skippedRow(sheet, ref.sourceRow, defect.id, `Defect-execution link for "${ref.bug}" already exists.`));
        continue;
      }
      await tx.defectExecutionLink.create({
        data: { defectId: defect.id, executionId: ref.executionId, createdBy: ctx.actorId }
      });
      linkKeys.add(key);
      await auditImport(tx, ctx, "DEFECT_EXECUTION_LINK_IMPORTED", "DefectExecutionLink", `${defect.id}:${ref.executionId}`, {
        defectId: defect.id,
        executionId: ref.executionId
      });
      report.push({
        sourceSheet: sheet,
        sourceRow: ref.sourceRow,
        outcome: "CREATED",
        recordId: defect.id,
        details: `Linked bug "${ref.bug}" to execution "${ref.executionBusinessId}".`
      });
    }
    return report;
  });
}

async function importRtmLinks(ctx: ImportContext, data: ParsedSheet) {
  const spec = SHEET_SPECS.rtm;
  await commitBatch(ctx, async (tx) => {
    const report: ReportRow[] = [];
    const rows = completeRows(spec, data, report);
    const [requirementList, featureList, moduleList, tcList, defectList, linkList] = await Promise.all([
      tx.requirement.findMany(),
      tx.feature.findMany(),
      tx.module.findMany(),
      tx.testCase.findMany(),
      tx.defect.findMany(),
      tx.requirementTraceLink.findMany()
    ]);
    const requirementByBiz = new Map(requirementList.map((r) => [r.businessId, r]));
    const featureById = new Map(featureList.map((f) => [f.id, f]));
    const moduleById = new Map(moduleList.map((m) => [m.id, m]));
    const tcByBiz = new Map(tcList.map((t) => [t.businessId, t]));
    const defectByBiz = new Map(defectList.map((d) => [d.businessId, d]));
    const linkKeys = new Set(linkList.map((l) => `${l.requirementId}\u0000${l.testCaseId}\u0000${l.defectId ?? ""}`));

    for (const row of rows) {
      const v = row.values;
      const requirement = requirementByBiz.get(v["Requirement ID"]);
      if (!requirement) {
        report.push(rejectedRow(spec.sheet, row.sourceRow, "REFERENCE_NOT_FOUND", `Requirement "${v["Requirement ID"]}" was not found.`));
        continue;
      }
      const testCase = tcByBiz.get(v["TC ID"]);
      if (!testCase) {
        report.push(rejectedRow(spec.sheet, row.sourceRow, "REFERENCE_NOT_FOUND", `Test case "${v["TC ID"]}" was not found.`));
        continue;
      }
      const feature = featureById.get(requirement.featureId);
      const moduleRec = feature ? moduleById.get(feature.moduleId) : undefined;
      const chainOk =
        requirement.id === testCase.requirementId &&
        requirement.featureId === testCase.featureId &&
        feature !== undefined &&
        feature.moduleId === testCase.moduleId &&
        moduleRec !== undefined &&
        moduleRec.productId === testCase.productId;
      if (!chainOk) {
        report.push(rejectedRow(spec.sheet, row.sourceRow, "HIERARCHY_MISMATCH", `Requirement "${v["Requirement ID"]}" does not belong to test case "${v["TC ID"]}"'s hierarchy chain.`));
        continue;
      }

      let defectId: string | null = null;
      if (v["Bug ID"]) {
        const defect = defectByBiz.get(v["Bug ID"]);
        if (!defect) {
          report.push(rejectedRow(spec.sheet, row.sourceRow, "REFERENCE_NOT_FOUND", `Bug "${v["Bug ID"]}" was not found.`));
          continue;
        }
        if (defect.testCaseId !== testCase.id) {
          report.push(rejectedRow(spec.sheet, row.sourceRow, "HIERARCHY_MISMATCH", `Bug "${v["Bug ID"]}" references a different test case than "${v["TC ID"]}".`));
          continue;
        }
        defectId = defect.id;
      }

      const key = `${requirement.id}\u0000${testCase.id}\u0000${defectId ?? ""}`;
      if (linkKeys.has(key)) {
        report.push(skippedRow(spec.sheet, row.sourceRow, testCase.id, "Identical trace link already exists."));
        continue;
      }
      const created = await tx.requirementTraceLink.create({
        data: {
          requirementId: requirement.id,
          testCaseId: testCase.id,
          defectId,
          createdBy: ctx.actorId
        }
      });
      linkKeys.add(key);
      await auditImport(tx, ctx, "RTM_LINK_IMPORTED", "RequirementTraceLink", created.id, created);
      report.push({ sourceSheet: spec.sheet, sourceRow: row.sourceRow, outcome: "CREATED", recordId: created.id });
    }
    return report;
  });
}

export async function listImportRuns(actorRole: QamsRole, options: PageRequest = {}) {
  // Imports are a QA-Lead capability (`roles-workflows.md:16`); the list powers the
  // admin screen and deliberately omits row reports — those load per run.
  ensureRole([...RoleSets.canAdmin], actorRole);
  return runPaged(
    options,
    (window) => prisma.importRun.findMany({ orderBy: { startedAt: "desc" }, ...window }),
    () => prisma.importRun.count()
  );
}

export async function getImportRun(id: string) {
  const run = await prisma.importRun.findUnique({
    where: { id },
    include: { rows: { orderBy: [{ sourceSheet: "asc" }, { sourceRow: "asc" }] } }
  });
  if (!run) throw new AppError(404, "REFERENCE_NOT_FOUND", "Import run not found.", "id");
  return run;
}

/**
 * Run a seed import.
 *
 * The role gate lives HERE, not only in the route. `docs/api-and-security.md:38`
 * requires the role/action matrix be enforced in domain services, and
 * `roles-workflows.md:16` confines imports to a QA Lead. Leaving it to the route
 * meant any future caller — a CLI, a scheduled job, a test — reached a thousand lines
 * of privileged, cross-table mutation with no authorization at all
 * (WORKBOOK-IMPORT-AUDIT-2026-07-31.md W3).
 */
export async function createImportRun(actor: ImportActor, fileName: string, rawBuffer: Buffer) {
  ensureRole([...RoleSets.canAdmin], actor.role);

  const actorId = actor.userId;
  const requestId = actor.requestId;
  const workbook = XLSX.read(rawBuffer, { type: "buffer", cellDates: true });
  for (const sheet of EXPECTED_SHEETS) {
    if (!workbook.SheetNames.includes(sheet)) {
      // A missing sheet is a malformed file, not a missing referenced record —
      // ID_INVALID is the established pairing for boundary-shape failures (audit W7).
      throw new AppError(422, "ID_INVALID", `Missing required sheet: ${sheet}.`);
    }
  }

  // Structural header validation for every imported sheet — before any write.
  const parsed = new Map<string, ParsedSheet>();
  const headerFailures: string[] = [];
  for (const spec of Object.values(SHEET_SPECS)) {
    const rows = sheetRows(workbook, spec.sheet);
    const header = findHeaderRow(rows, spec);
    if (!header) {
      headerFailures.push(spec.sheet);
    } else {
      parsed.set(spec.sheet, { rows, header });
    }
  }
  if (headerFailures.length > 0) {
    throw new AppError(
      422,
      "ID_INVALID",
      `Required headers were not found in sheet(s): ${headerFailures.join(", ")}.`,
      headerFailures[0]
    );
  }

  const run = await prisma.importRun.create({
    data: {
      sourceFileName: fileName,
      sourceFileHash: createHash("sha256").update(rawBuffer).digest("hex"),
      actorId,
      status: "RUNNING",
      reportJson: { status: "RUNNING" },
      createdBy: actorId
    }
  });

  const ctx: ImportContext = {
    runId: run.id,
    actor,
    actorId,
    requestId,
    allReports: [],
    stagedBugRefs: [],
    activeValues: new Map()
  };

  try {
    await importSettings(ctx, sheetData(parsed, SHEET_SPECS.settings.sheet));
    await importProducts(ctx, sheetData(parsed, SHEET_SPECS.productMaster.sheet));
    await importModules(ctx, sheetData(parsed, SHEET_SPECS.moduleMaster.sheet));
    await importFeatures(ctx, sheetData(parsed, SHEET_SPECS.featureMaster.sheet));
    await importRequirements(ctx, sheetData(parsed, SHEET_SPECS.requirementMaster.sheet));
    await importTestCasesAndSteps(
      ctx,
      sheetData(parsed, SHEET_SPECS.testRepository.sheet),
      sheetData(parsed, SHEET_SPECS.testSteps.sheet)
    );
    await importExecutions(ctx, sheetData(parsed, SHEET_SPECS.testExecution.sheet));
    await importExecutionHistory(ctx, sheetData(parsed, SHEET_SPECS.executionHistory.sheet));
    await importDefects(ctx, sheetData(parsed, SHEET_SPECS.bugTracker.sheet));
    await resolveBugLinks(ctx);
    await importRtmLinks(ctx, sheetData(parsed, SHEET_SPECS.rtm.sheet));
  } catch (err) {
    await prisma.importRun
      .update({ where: { id: run.id }, data: { status: "FAILED", completedAt: new Date() } })
      .catch(() => undefined);
    if (err instanceof AppError) throw err;
    throw new AppError(500, "INTERNAL_ERROR", "Import failed unexpectedly; committed batches were preserved.");
  }

  // Finalize: per-sheet outcome counts, unknown columns, recomputed dashboard metrics, policy gaps.
  const outcomeCounts: Record<string, Record<string, number>> = {};
  for (const row of ctx.allReports) {
    const sheetCounts = outcomeCounts[row.sourceSheet] ?? {};
    sheetCounts[row.outcome] = (sheetCounts[row.outcome] ?? 0) + 1;
    outcomeCounts[row.sourceSheet] = sheetCounts;
  }
  const unknownColumns: Record<string, string[]> = {};
  for (const [sheetName, data] of parsed) {
    if (data.header.unknownColumns.length > 0) {
      unknownColumns[sheetName] = data.header.unknownColumns;
    }
  }
  const [productCount, testCaseCount] = await Promise.all([
    // Same Prisma shape fix as dashboardSnapshot: `mode` is invalid nested inside
    // `not: {}` and threw, failing the whole import at the finalize step.
    prisma.product.count({ where: { NOT: { status: { equals: "Retired", mode: "insensitive" } } } }),
    prisma.testCase.count({ where: { lifecycleState: { not: TestCaseLifecycleState.RETIRED } } })
  ]);

  // One transaction, deliberately: every per-record audit event inside the batches is
  // written atomically with its record, and the completion pair must hold to the same
  // standard — a crash between the status update and the IMPORT_COMPLETED event would
  // otherwise leave a completed run with no completion event (audit W9).
  const completed = await prisma.$transaction(async (tx) => {
    const updated = await tx.importRun.update({
      where: { id: run.id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        reportJson: {
          outcomeCounts,
          unknownColumns,
          dashboard: { products: productCount, testCases: testCaseCount },
          policyGaps: [
            "Test cases were imported as Approved with the importing QA Lead recorded as author, per the seed-import exception in roles-workflows.md; they did not pass through Draft → In Review.",
            "Product Status is imported as preserved text: the workbook seeds no Status catalogue, so no catalogue validation was possible (policy gap; QA Lead follow-up).",
            "Test Repository Execution Status is a legacy summary; it is preserved in each row report's details and creates no execution."
          ]
        }
      }
    });
    await appendAudit(tx, {
      actorId,
      action: "IMPORT_COMPLETED",
      entityType: "ImportRun",
      entityId: run.id,
      requestId,
      beforeAfterJson: {
        after: {
          sourceFileName: fileName,
          status: updated.status,
          rowCount: ctx.allReports.length,
          outcomeCounts
        }
      }
    });
    return updated;
  });

  return completed;
}
