import * as XLSX from "xlsx";
import { EXPECTED_SHEETS, SHEET_SPECS, type SheetSpec } from "./import-parsing";

/**
 * Builds the sample/template workbook offered from the imports screen.
 *
 * ## Why the headers are generated, never typed out
 *
 * Every sheet's header row comes straight from `SHEET_SPECS` — the same constant the
 * parser matches against. A hand-written template is a second copy of the contract that
 * silently rots the first time a required header changes, and the failure mode is
 * miserable: the QA Lead fills in the file the application gave them and the application
 * rejects it. Deriving the headers means the template cannot disagree with the parser,
 * and `import-template.test.ts` asserts exactly that.
 *
 * The sheet ORDER follows `docs/excel-source-map.md` § "Import order and behavior", so
 * reading the tabs left to right is reading the dependency order: controlled values,
 * then the hierarchy, then cases and steps, then executions, defects and RTM links.
 *
 * ## Why two sheets ship with headers but no example rows
 *
 * `Test Execution` and `Execution History` reference a **Tester by display name**, which
 * the importer resolves against real users (`REFERENCE_NOT_FOUND` when it cannot). A
 * generic template has no way to know a name that exists in the destination system, so
 * inventing one would guarantee that downloading the sample and uploading it unchanged
 * produces rejected rows. Headers only means the sample imports cleanly, and the columns
 * are still documented by their presence.
 *
 * Everything else is a self-contained, internally consistent example: the IDs chain
 * PROD001 -> MOD001 -> FEAT001 -> REQ001 -> TC-PROD001-0001, and every controlled value
 * used appears on the Settings sheet.
 *
 * Pure: no Prisma, no filesystem, no session. It takes nothing and returns bytes.
 */

/** Rows for a sheet, EXCLUDING the header row (which is generated from the spec). */
type SampleRows = readonly (readonly (string | number)[])[];

/**
 * The example rows, keyed by the same keys as `SHEET_SPECS`. Each inner array is
 * positional against that spec's `requiredHeaders`, which the test asserts — so a
 * reordered or added header fails the build rather than silently shifting a column.
 */
const SAMPLE_ROWS: Record<keyof typeof SHEET_SPECS, SampleRows> = {
  // Priority / Severity / Result are three independent lists read column-wise, so the
  // rows are ragged by nature rather than by accident (`docs/excel-source-map.md`).
  settings: [
    ["High", "Critical", "Pass"],
    ["Medium", "Major", "Fail"],
    ["Low", "Minor", "Blocked"]
  ],
  productMaster: [["PROD001", "Sample Product", "1.0", "Active"]],
  moduleMaster: [["MOD001", "PROD001", "Checkout"]],
  featureMaster: [["FEAT001", "MOD001", "Card payment"]],
  requirementMaster: [
    ["REQ001", "FEAT001", "A customer can pay with a valid credit card."]
  ],
  testRepository: [
    [
      "TC-PROD001-0001",
      "PROD001",
      "MOD001",
      "FEAT001",
      "REQ001",
      "Cycle 1",
      "Sprint 1",
      "R1.0",
      "SIT",
      "High",
      "Major",
      "Payment succeeds with a valid card",
      "Confirm a valid card completes checkout.",
      "The order is confirmed and a receipt is shown.",
      // Legacy source annotation only; it does not create an execution
      // (`docs/excel-source-map.md:16`).
      "Not Executed"
    ]
  ],
  testSteps: [
    ["TC-PROD001-0001", 1, "Add an item to the basket.", "The basket shows one item."],
    ["TC-PROD001-0001", 2, "Enter a valid card and submit.", "Payment is accepted."],
    ["TC-PROD001-0001", 3, "Return to the order list.", "The new order is listed as confirmed."]
  ],
  // Headers only — see the module comment: the Tester column needs a real user.
  testExecution: [],
  executionHistory: [],
  bugTracker: [["BUG-0001", "TC-PROD001-0001", "Receipt total omits tax", "New"]],
  rtm: [["REQ001", "TC-PROD001-0001", "BUG-0001"]]
};

/**
 * Sheet name -> the spec key that owns it, so the sheet order can drive generation.
 * Keyed by plain `string` because `EXPECTED_SHEETS` is deliberately wider than the
 * parsed set: a miss means "no parse spec", which is the signal to fall through to
 * `UNPARSED_SHEETS`, not a type error.
 */
const SPEC_BY_SHEET = new Map<string, keyof typeof SHEET_SPECS>(
  (Object.keys(SHEET_SPECS) as (keyof typeof SHEET_SPECS)[]).map((key) => [SHEET_SPECS[key].sheet, key])
);

/**
 * The two sheets with no parse spec. `createImportRun` refuses a workbook that lacks
 * ANY of `EXPECTED_SHEETS`, so a template missing these is rejected before a single row
 * is read — which is exactly how this was found. Their content is never parsed, so what
 * goes in them is documentation for the reader and nothing more.
 */
const UNPARSED_SHEETS: Record<string, (string | number)[][]> = {
  // `docs/excel-source-map.md`: navigation labels, not imported.
  Home: [
    ["Enterprise QA Test Case Management — import template"],
    [],
    ["This sheet is not imported. Application navigation derives from role capabilities."],
    ["Fill in the sheets that follow, then upload the file on Admin → Workbook imports."],
    ["Every sheet listed here must exist, even when you leave it empty."]
  ],
  // `docs/excel-source-map.md`: a derived view; formula results are never imported.
  Dashboard: [
    ["Metric", "Value"],
    ["Products", "(recomputed by the application)"],
    ["Test Cases", "(recomputed by the application)"],
    [],
    ["This sheet is not imported. Dashboard figures are recalculated from persisted records."]
  ]
};

/** Header row plus example rows, as the array-of-arrays SheetJS builds a sheet from. */
export function sheetGrid(spec: SheetSpec, rows: SampleRows): (string | number)[][] {
  return [[...spec.requiredHeaders], ...rows.map((row) => [...row])];
}

/** Column widths sized to the header, so the template opens readable rather than clipped. */
function columnWidths(spec: SheetSpec, rows: SampleRows) {
  return spec.requiredHeaders.map((header, index) => {
    const longestCell = rows.reduce(
      (widest, row) => Math.max(widest, String(row[index] ?? "").length),
      0
    );
    return { wch: Math.min(48, Math.max(header.length, longestCell) + 2) };
  });
}

export const SAMPLE_WORKBOOK_FILENAME = "qams-import-template.xlsx";

/** The sample workbook as bytes, ready to stream as an .xlsx download. */
export function buildSampleWorkbook(): Buffer {
  const workbook = XLSX.utils.book_new();

  // Driven by EXPECTED_SHEETS, so the template gains any sheet the importer starts
  // demanding — including the ones with no parse spec — instead of silently omitting it.
  for (const sheetName of EXPECTED_SHEETS) {
    const key = SPEC_BY_SHEET.get(sheetName);

    if (key === undefined) {
      const worksheet = XLSX.utils.aoa_to_sheet(UNPARSED_SHEETS[sheetName] ?? [[sheetName]]);
      worksheet["!cols"] = [{ wch: 64 }, { wch: 32 }];
      XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
      continue;
    }

    const spec: SheetSpec = SHEET_SPECS[key];
    const rows = SAMPLE_ROWS[key];
    const worksheet = XLSX.utils.aoa_to_sheet(sheetGrid(spec, rows));
    worksheet["!cols"] = columnWidths(spec, rows);
    // Sheet names are the parser's lookup key, so they come from the spec verbatim.
    XLSX.utils.book_append_sheet(workbook, worksheet, spec.sheet);
  }

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
