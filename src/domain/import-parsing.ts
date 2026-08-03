/**
 * Pure workbook-parsing helpers for the seed import (no Prisma, no I/O).
 *
 * Sheet names, required headers, and row semantics follow `docs/excel-source-map.md`;
 * classification rules (blank rows ignored, partial rows -> ROW_INCOMPLETE, headers
 * matched exactly after normalized whitespace) follow the Import rules in
 * `docs/business-rules-and-validation.md`.
 */

export type SheetSpec = {
  readonly sheet: string;
  /** Headers that must all be present in the header row (exact match after whitespace normalization). */
  readonly requiredHeaders: readonly string[];
  /** Headers whose cells may be blank within a data row without making the row PARTIAL. */
  readonly optionalFields: readonly string[];
};

/**
 * Every sheet the workbook must contain for its structure to be accepted, in source
 * order (`docs/excel-source-map.md` § "Sheet-to-domain mapping"). A missing one is a
 * malformed file, refused before any write.
 *
 * Wider than `SHEET_SPECS` on purpose: `Home` is navigation labels and `Dashboard` is a
 * derived view whose formula results are explicitly never imported, so neither has a
 * parse spec — but both must be PRESENT, because their absence means the file is not
 * the workbook this system reads.
 *
 * Lives here, in the pure module, rather than beside the importer, so that the sample
 * workbook generator can build against the same list without reaching through Prisma.
 */
export const EXPECTED_SHEETS = [
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
] as const;

export const SHEET_SPECS = {
  settings: {
    sheet: "Settings",
    requiredHeaders: ["Priority", "Severity", "Result"],
    // The three columns are independent value lists; any subset of a row may be filled.
    optionalFields: ["Priority", "Severity", "Result"]
  },
  productMaster: {
    sheet: "Product Master",
    requiredHeaders: ["Product ID", "Product", "Version", "Status"],
    optionalFields: []
  },
  moduleMaster: {
    sheet: "Module Master",
    requiredHeaders: ["Module ID", "Product ID", "Module"],
    optionalFields: []
  },
  featureMaster: {
    sheet: "Feature Master",
    requiredHeaders: ["Feature ID", "Module ID", "Feature"],
    optionalFields: []
  },
  requirementMaster: {
    sheet: "Requirement Master",
    requiredHeaders: ["Requirement ID", "Feature ID", "Requirement"],
    optionalFields: []
  },
  testRepository: {
    sheet: "Test Repository",
    requiredHeaders: [
      "TC ID",
      "Product ID",
      "Module ID",
      "Feature ID",
      "Requirement ID",
      "Cycle",
      "Sprint",
      "Release",
      "Environment",
      "Priority",
      "Severity",
      "Title",
      "Objective",
      "Expected Result",
      "Execution Status"
    ],
    // The COLUMN must exist (it is part of the documented header set), but a blank
    // CELL must not discard the test case. `docs/excel-source-map.md:16` describes
    // Execution Status as seeding "only a legacy summary; it does not create an
    // execution" — so a row missing only that annotation is not the "partially
    // populated" row `docs/business-rules-and-validation.md:43` reserves
    // ROW_INCOMPLETE for. Treating it as mandatory silently dropped otherwise valid
    // test cases.
    optionalFields: ["Execution Status"]
  },
  testSteps: {
    sheet: "Test Steps",
    requiredHeaders: ["TC ID", "Step", "Action", "Expected"],
    optionalFields: []
  },
  testExecution: {
    sheet: "Test Execution",
    requiredHeaders: ["Execution ID", "TC ID", "Tester", "Result", "Bug"],
    optionalFields: ["Result", "Bug"]
  },
  executionHistory: {
    sheet: "Execution History",
    requiredHeaders: ["Execution ID", "TC ID", "Result", "Date"],
    optionalFields: []
  },
  bugTracker: {
    sheet: "Bug Tracker",
    requiredHeaders: ["Bug ID", "TC ID", "Summary", "Status"],
    optionalFields: []
  },
  rtm: {
    sheet: "RTM",
    requiredHeaders: ["Requirement ID", "TC ID", "Bug ID"],
    optionalFields: ["Bug ID"]
  }
} as const satisfies Record<string, SheetSpec>;

/** Coerce an xlsx cell value to a trimmed string ("" for blank). Dates become ISO strings. */
export function normalizeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return String(value).trim();
}

/** Trim and collapse internal whitespace runs to a single space. */
export function normalizeHeader(value: unknown): string {
  return normalizeCell(value).replace(/\s+/g, " ").trim();
}

/** Normalized-whitespace equality used by every idempotency comparison (case-sensitive). */
export function valuesEqual(a: unknown, b: unknown): boolean {
  return normalizeHeader(a) === normalizeHeader(b);
}

export type HeaderInfo = {
  /** 0-based index of the header row within the supplied rows. */
  headerRowIndex: number;
  /** Required header name -> 0-based column index. */
  columnMap: Record<string, number>;
  /** Non-empty header cells that are not required headers (reported, then ignored). */
  unknownColumns: string[];
};

/**
 * Find the first row whose cells contain every required header (exact match after
 * whitespace normalization). Returns null when no row matches.
 */
export function findHeaderRow(rows: readonly unknown[][], spec: SheetSpec): HeaderInfo | null {
  for (let r = 0; r < rows.length; r += 1) {
    const cells = rows[r] ?? [];
    const columnMap: Record<string, number> = {};
    const unknownColumns: string[] = [];
    for (let c = 0; c < cells.length; c += 1) {
      const header = normalizeHeader(cells[c]);
      if (!header) continue;
      if (spec.requiredHeaders.includes(header)) {
        if (!(header in columnMap)) columnMap[header] = c;
      } else {
        unknownColumns.push(header);
      }
    }
    if (spec.requiredHeaders.every((h) => h in columnMap)) {
      return { headerRowIndex: r, columnMap, unknownColumns };
    }
  }
  return null;
}

export type RowKind = "BLANK" | "PARTIAL" | "COMPLETE";

export type ExtractedRow = {
  /** 1-based worksheet row number (relative to the sheet's used range). */
  sourceRow: number;
  kind: RowKind;
  /** Required header name -> normalized cell string ("" for blank). */
  values: Record<string, string>;
};

/**
 * Extract every data row below the header row. Fully blank rows are BLANK (ignored by
 * the importer); rows with at least one mandatory cell blank while something else is
 * filled are PARTIAL (-> ROW_INCOMPLETE); rows with all mandatory cells filled are
 * COMPLETE. Optional fields never make a row PARTIAL by being blank.
 */
export function extractRows(
  rows: readonly unknown[][],
  headerInfo: HeaderInfo,
  spec: SheetSpec
): ExtractedRow[] {
  const mandatory = spec.requiredHeaders.filter((h) => !spec.optionalFields.includes(h));
  const out: ExtractedRow[] = [];
  for (let r = headerInfo.headerRowIndex + 1; r < rows.length; r += 1) {
    const cells = rows[r] ?? [];
    const values: Record<string, string> = {};
    for (const header of spec.requiredHeaders) {
      values[header] = normalizeCell(cells[headerInfo.columnMap[header]]);
    }
    const filledAny = spec.requiredHeaders.some((h) => values[h] !== "");
    const mandatoryFilled = mandatory.filter((h) => values[h] !== "").length;
    let kind: RowKind;
    if (!filledAny) kind = "BLANK";
    else if (mandatoryFilled === mandatory.length) kind = "COMPLETE";
    else kind = "PARTIAL";
    out.push({ sourceRow: r + 1, kind, values });
  }
  return out;
}

/**
 * ISO-8601 date, optionally with a time and an offset. Deliberately narrow — see
 * `parseHistoryDate`.
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * Parse an Execution History `Date` cell: `Date` objects (from `cellDates: true`),
 * Excel serial numbers, and **ISO-8601 strings only**. Anything else returns null,
 * which the importer reports as a rejected row.
 *
 * WHY STRINGS ARE RESTRICTED. This used to call `new Date(trimmed)` on any string.
 * For non-ISO input that is implementation-defined: `"01/02/2026"` parses as 2 January
 * in a US locale and 1 February in most others, and **both succeed** — so there was no
 * error to report and no way to notice. The value becomes `occurredAt` on an
 * `ExecutionHistory` row, which `docs/data-model.md:48` makes immutable. A silently
 * wrong timestamp in an append-only audit record is worse than a rejected row:
 * a rejection is recoverable by fixing the workbook, a wrong date is not.
 *
 * A rejected row still names the offending value, so an ambiguous format is a
 * fixable, visible problem rather than a silent corruption.
 *
 * DETERMINISM. A time with no offset (`2026-03-04T05:06`) is interpreted by JS in the
 * server's local zone, which would make an import's result depend on where it ran.
 * Such values are treated as UTC. A date with no time is already UTC midnight per the
 * ECMAScript spec.
 */
export function parseHistoryDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    // Excel 1900 date system: serial days since 1899-12-30 (serial 25569 = 1970-01-01).
    return new Date(Math.round((value - 25569) * 86_400_000));
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;

    const match = ISO_DATE.exec(trimmed);
    if (!match) return null;

    // The calendar day is checked BEFORE constructing a Date, because Date does not
    // reject an impossible one -- `new Date("2026-02-30")` silently ROLLS OVER to
    // 2026-03-02. A typo in a workbook would otherwise become a different, entirely
    // plausible immutable timestamp, which is the exact failure this parser exists to
    // prevent. Checked from the digits so an explicit offset cannot shift the day and
    // cause a false rejection.
    const [year, month, day] = trimmed.slice(0, 10).split("-").map(Number);
    if (month < 1 || month > 12) return null;
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (day < 1 || day > daysInMonth) return null;

    const hasTime = /[T ]\d{2}:/.test(trimmed);
    const hasOffset = Boolean(match[1]);
    const normalized = trimmed.replace(" ", "T") + (hasTime && !hasOffset ? "Z" : "");

    // Date still owns time-component validation (T25:00 and similar).
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

export type ExecutionResultToken = "PASS" | "FAIL" | "BLOCKED";

/**
 * Normalize an execution `Result` cell: blank -> null (planned execution),
 * Pass/Fail/Blocked (case-insensitive) -> token, anything else (including the legacy
 * `Not Executed`) -> "INVALID".
 */
export function normalizeExecutionResult(value: unknown): ExecutionResultToken | "INVALID" | null {
  const text = normalizeHeader(value);
  if (!text) return null;
  const upper = text.toUpperCase();
  if (upper === "PASS" || upper === "FAIL" || upper === "BLOCKED") return upper;
  return "INVALID";
}

const DEFECT_STATUS_TOKENS = ["NEW", "TRIAGED", "IN_PROGRESS", "RESOLVED", "CLOSED"] as const;

export type DefectStatusToken = (typeof DEFECT_STATUS_TOKENS)[number];

/**
 * Normalize a Bug Tracker `Status` cell against the defect lifecycle names
 * (case-insensitive; internal whitespace/hyphens count as the underscore, which is
 * whitespace normalization, not a value mapping). No other mappings are invented:
 * anything else returns null.
 */
export function normalizeDefectStatus(value: unknown): DefectStatusToken | null {
  const text = normalizeHeader(value);
  if (!text) return null;
  const token = text.toUpperCase().replace(/[\s-]+/g, "_");
  return (DEFECT_STATUS_TOKENS as readonly string[]).includes(token)
    ? (token as DefectStatusToken)
    : null;
}

export type SettingsValue = { catalogue: "Priority" | "Severity" | "Result"; value: string; sourceRow: number };

const SETTINGS_CATALOGUES = ["Priority", "Severity", "Result"] as const;

/**
 * The Settings sheet holds three independent value columns. Extract every non-blank
 * cell below the header row as a (catalogue, value, sourceRow) triple.
 */
export function extractSettingsValues(rows: readonly unknown[][], headerInfo: HeaderInfo): SettingsValue[] {
  const out: SettingsValue[] = [];
  for (let r = headerInfo.headerRowIndex + 1; r < rows.length; r += 1) {
    const cells = rows[r] ?? [];
    for (const catalogue of SETTINGS_CATALOGUES) {
      const col = headerInfo.columnMap[catalogue];
      const value = normalizeHeader(col === undefined ? undefined : cells[col]);
      if (value) out.push({ catalogue, value, sourceRow: r + 1 });
    }
  }
  return out;
}
