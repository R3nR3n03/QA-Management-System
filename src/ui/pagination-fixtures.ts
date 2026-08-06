import type { DefectLifecycleState, ExecutionLifecycleState } from "@prisma/client";
import type { CaseRow } from "./case-table";
import type { DefectRowData, ExecutionRowData } from "./record-list";
import type { ImportRowData } from "../app/(app)/admin/imports/[id]/RowsTable";

/**
 * Row generators for the pagination component tests. Deliberately NOT a `.test.ts`
 * file (it must not match the test glob) and imported only by tests — `npm run build`
 * proves it never reaches the app bundle.
 *
 * The filterable lists (CaseTable, ExecutionList, DefectList, RowsTable) hardcode
 * `PAGE_SIZE = 50` and expose no `pageSize` prop, so exercising their pagers takes
 * 51+ rows. Every generated row carries predictable, findable text: business IDs
 * number from 1 (`TC-FIX-0001`…) and titles/summaries embed the same number, so a
 * test can assert "row 51 appears only on page 2" by exact string.
 */

const pad = (n: number) => String(n).padStart(4, "0");

export function makeCaseRows(count: number): CaseRow[] {
  return Array.from({ length: count }, (_, index) => {
    const n = index + 1;
    return {
      id: `case-${n}`,
      businessId: `TC-FIX-${pad(n)}`,
      title: `Case title ${n}`,
      lifecycleState: "APPROVED" as const,
      priority: "High",
      severity: "Major"
    };
  });
}

/* Fixed instants, never `new Date()`: a row's rendered stamp is asserted by exact
   string, so the fixture must not drift with the clock the suite happens to run on. */
const PLANNED_AT = new Date("2026-01-05T09:00:00.000Z");
const STARTED_AT = new Date("2026-01-06T10:30:00.000Z");
const FINALIZED_AT = new Date("2026-01-07T14:45:00.000Z");

export function makeExecutionRows(
  count: number,
  options: { state?: ExecutionLifecycleState; idOffset?: number } = {}
): ExecutionRowData[] {
  const { state = "PLANNED", idOffset = 0 } = options;
  const started = state === "IN_PROGRESS" || state === "FINALIZED";
  return Array.from({ length: count }, (_, index) => {
    const n = idOffset + index + 1;
    return {
      id: `execution-${n}`,
      businessId: `EXE-${pad(n)}`,
      state,
      result: state === "FINALIZED" ? ("PASS" as const) : null,
      caseBusinessIds: [`TC-FIX-${pad(n)}`],
      caseTitle: `Execution title ${n}`,
      testerName: "Fixture Tester",
      caseResults: [state === "FINALIZED" ? ("PASS" as const) : null],
      plannedAt: PLANNED_AT,
      startedAt: started ? STARTED_AT : null,
      finalizedAt: state === "FINALIZED" ? FINALIZED_AT : null
    };
  });
}

export function makeDefectRows(count: number): DefectRowData[] {
  return Array.from({ length: count }, (_, index) => {
    const n = index + 1;
    return {
      id: `defect-${n}`,
      businessId: `BUG-${pad(n)}`,
      status: "NEW" as DefectLifecycleState,
      summary: `Defect summary ${n}`,
      priority: "High",
      severity: "Major",
      caseBusinessId: `TC-FIX-${pad(n)}`
    };
  });
}

/**
 * Import report rows with sortable variety: the first half sits on sheet "Alpha",
 * the second half on "Beta"; outcomes alternate so the Outcome column reorders rows
 * observably.
 */
export function makeImportRows(count: number): ImportRowData[] {
  return Array.from({ length: count }, (_, index) => {
    const n = index + 1;
    return {
      id: `row-${n}`,
      sourceSheet: n <= count / 2 ? "Alpha" : "Beta",
      sourceRow: n,
      outcome: n % 2 === 0 ? "CREATED" : "REJECTED",
      errorCode: n % 2 === 0 ? null : "ID_INVALID",
      details: `Detail ${n}`,
      proposedValues: null,
      resolutionDecision: null,
      resolutionRationale: null,
      resolvedAt: null,
      resolvedBy: null
    };
  });
}
