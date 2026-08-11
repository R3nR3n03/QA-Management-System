import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  SHEET_SPECS,
  extractRows,
  extractSettingsValues,
  findHeaderRow,
  normalizeCell,
  normalizeDefectStatus,
  normalizeExecutionResult,
  normalizeHeader,
  parseHistoryDate,
  valuesEqual
} from "./import-parsing";

describe("SHEET_SPECS", () => {
  it("covers the 11 imported sheets (Home and Dashboard are not imported)", () => {
    const sheets = Object.values(SHEET_SPECS).map((spec) => spec.sheet);
    expect(sheets).toHaveLength(11);
    expect(sheets).toContain("Settings");
    expect(sheets).not.toContain("Home");
    expect(sheets).not.toContain("Dashboard");
  });

  it("marks RTM Bug ID, Execution Result/Bug/Purpose and the legacy Execution Status as optional", () => {
    expect([...SHEET_SPECS.rtm.optionalFields]).toEqual(["Bug ID"]);
    expect([...SHEET_SPECS.testExecution.optionalFields]).toEqual(["Result", "Bug", "Purpose"]);
    // excel-source-map.md:16 - Execution Status seeds "only a legacy summary" and
    // creates no execution, so a blank cell must not discard the whole test case.
    expect([...SHEET_SPECS.testRepository.optionalFields]).toEqual(["Execution Status"]);
  });

  it("keeps every documented header required even where the cell may be blank", () => {
    // Optional means the CELL may be blank, never that the COLUMN may be absent.
    for (const spec of Object.values(SHEET_SPECS)) {
      for (const optional of spec.optionalFields) {
        expect(spec.requiredHeaders).toContain(optional);
      }
    }
  });
});

describe("normalizeHeader / normalizeCell", () => {
  it("trims and collapses internal whitespace runs", () => {
    expect(normalizeHeader("  Product   ID \t")).toBe("Product ID");
  });

  it("coerces numbers and blanks", () => {
    expect(normalizeCell(3)).toBe("3");
    expect(normalizeCell(null)).toBe("");
    expect(normalizeCell(undefined)).toBe("");
    expect(normalizeCell("  x  ")).toBe("x");
  });

  it("converts Date cells to ISO strings", () => {
    expect(normalizeCell(new Date("2026-01-02T00:00:00.000Z"))).toBe("2026-01-02T00:00:00.000Z");
  });
});

describe("findHeaderRow", () => {
  it("finds the header row dynamically below title rows and maps columns", () => {
    const rows: unknown[][] = [
      ["Product Master — seed workbook"],
      [],
      ["Product  ID", "Product", "Version", "Status"],
      ["PROD001", "Portal", "1.0", "Active"]
    ];
    const info = findHeaderRow(rows, SHEET_SPECS.productMaster);
    expect(info).not.toBeNull();
    expect(info?.headerRowIndex).toBe(2);
    expect(info?.columnMap).toEqual({ "Product ID": 0, Product: 1, Version: 2, Status: 3 });
    expect(info?.unknownColumns).toEqual([]);
  });

  it("reports unknown extra columns but still matches", () => {
    const rows: unknown[][] = [["Product ID", "Product", "Owner", "Version", "Status"]];
    const info = findHeaderRow(rows, SHEET_SPECS.productMaster);
    expect(info?.unknownColumns).toEqual(["Owner"]);
    expect(info?.columnMap["Version"]).toBe(3);
  });

  it("returns null when a required header is missing", () => {
    const rows: unknown[][] = [["Product ID", "Product", "Version"]];
    expect(findHeaderRow(rows, SHEET_SPECS.productMaster)).toBeNull();
  });

  it("requires exact names after whitespace normalization (no fuzzy matching)", () => {
    const rows: unknown[][] = [["Product Identifier", "Product", "Version", "Status"]];
    expect(findHeaderRow(rows, SHEET_SPECS.productMaster)).toBeNull();
  });
});

describe("extractRows", () => {
  const productRows: unknown[][] = [
    ["Product ID", "Product", "Version", "Status"],
    ["PROD001", "Portal", "1.0", "Active"],
    [null, null, null, null],
    ["PROD002", null, "2.0", "Active"]
  ];

  it("classifies blank, partial, and complete rows with 1-based source rows", () => {
    const info = findHeaderRow(productRows, SHEET_SPECS.productMaster);
    expect(info).not.toBeNull();
    if (!info) return;
    const rows = extractRows(productRows, info, SHEET_SPECS.productMaster);
    expect(rows.map((r) => r.kind)).toEqual(["COMPLETE", "BLANK", "PARTIAL"]);
    expect(rows[0].sourceRow).toBe(2);
    expect(rows[2].sourceRow).toBe(4);
    expect(rows[0].values["Product ID"]).toBe("PROD001");
  });

  it("does not treat blank optional fields as partial (Test Execution Purpose/Result/Bug)", () => {
    const exeRows: unknown[][] = [
      ["Execution ID", "TC ID", "Purpose", "Tester", "Result", "Bug"],
      ["EXE-0001", "TC-PORTAL-0001", null, "Jane Q", null, null],
      [null, null, null, null, null, "BUG-0001"]
    ];
    const info = findHeaderRow(exeRows, SHEET_SPECS.testExecution);
    expect(info).not.toBeNull();
    if (!info) return;
    const rows = extractRows(exeRows, info, SHEET_SPECS.testExecution);
    expect(rows[0].kind).toBe("COMPLETE");
    expect(rows[0].values["Result"]).toBe("");
    // Only an optional cell filled while mandatory cells are blank -> PARTIAL, not BLANK.
    expect(rows[1].kind).toBe("PARTIAL");
  });

  it("treats a blank optional RTM Bug ID as complete", () => {
    const rtmRows: unknown[][] = [
      ["Requirement ID", "TC ID", "Bug ID"],
      ["REQ001", "TC-PORTAL-0001", null]
    ];
    const info = findHeaderRow(rtmRows, SHEET_SPECS.rtm);
    expect(info).not.toBeNull();
    if (!info) return;
    expect(extractRows(rtmRows, info, SHEET_SPECS.rtm)[0].kind).toBe("COMPLETE");
  });
});

describe("normalizeExecutionResult", () => {
  it("maps Pass/Fail/Blocked case-insensitively", () => {
    expect(normalizeExecutionResult("pass")).toBe("PASS");
    expect(normalizeExecutionResult(" Fail ")).toBe("FAIL");
    expect(normalizeExecutionResult("BLOCKED")).toBe("BLOCKED");
  });

  it("returns null for blank and INVALID for anything else, including legacy Not Executed", () => {
    expect(normalizeExecutionResult("")).toBeNull();
    expect(normalizeExecutionResult(null)).toBeNull();
    expect(normalizeExecutionResult("Not Executed")).toBe("INVALID");
    expect(normalizeExecutionResult("Passed")).toBe("INVALID");
  });
});

describe("normalizeDefectStatus", () => {
  it("matches lifecycle names case-insensitively, treating spaces as underscores", () => {
    expect(normalizeDefectStatus("new")).toBe("NEW");
    expect(normalizeDefectStatus("Triaged")).toBe("TRIAGED");
    expect(normalizeDefectStatus("In Progress")).toBe("IN_PROGRESS");
    expect(normalizeDefectStatus("RESOLVED")).toBe("RESOLVED");
    expect(normalizeDefectStatus("closed")).toBe("CLOSED");
  });

  it("returns null for blank or unmapped values (no invented mappings)", () => {
    expect(normalizeDefectStatus("")).toBeNull();
    expect(normalizeDefectStatus("Reopened")).toBeNull();
    expect(normalizeDefectStatus("Fixed")).toBeNull();
  });
});

describe("parseHistoryDate", () => {
  it("passes through valid Date objects (cellDates: true)", () => {
    const date = new Date("2026-03-04T05:06:07.000Z");
    expect(parseHistoryDate(date)).toBe(date);
  });

  it("parses ISO strings (normalizeCell output for date cells)", () => {
    expect(parseHistoryDate("2026-03-04T05:06:07.000Z")?.getTime()).toBe(
      new Date("2026-03-04T05:06:07.000Z").getTime()
    );
  });

  it("converts Excel serial numbers (serial 25569 = 1970-01-01)", () => {
    expect(parseHistoryDate(25569)?.toISOString()).toBe("1970-01-01T00:00:00.000Z");
  });

  it("returns null for blank or unparsable values", () => {
    expect(parseHistoryDate("")).toBeNull();
    expect(parseHistoryDate("not a date")).toBeNull();
    expect(parseHistoryDate(null)).toBeNull();
    expect(parseHistoryDate(new Date("invalid"))).toBeNull();
  });

  /**
   * The reason this parser is narrow. `new Date("01/02/2026")` succeeds in every
   * locale and means a different day depending on the locale, so an ambiguous cell
   * used to produce a plausible, wrong, immutable occurredAt with nothing to report.
   * Rejection is recoverable; a wrong date in append-only history is not.
   */
  it("rejects locale-ambiguous formats rather than guessing a day", () => {
    for (const ambiguous of ["01/02/2026", "1/2/2026", "01-02-2026", "02.01.2026"]) {
      expect(parseHistoryDate(ambiguous)).toBeNull();
    }
  });

  it("rejects prose dates that Date would happily accept", () => {
    for (const prose of ["March 4 2026", "4 March 2026", "Mar 4, 2026", "2026/03/04"]) {
      expect(parseHistoryDate(prose)).toBeNull();
    }
  });

  it("accepts the ISO shapes a workbook actually produces", () => {
    expect(parseHistoryDate("2026-03-04")?.toISOString()).toBe("2026-03-04T00:00:00.000Z");
    expect(parseHistoryDate("2026-03-04T05:06:07Z")?.toISOString()).toBe("2026-03-04T05:06:07.000Z");
    expect(parseHistoryDate("2026-03-04T05:06:07.123Z")?.toISOString()).toBe(
      "2026-03-04T05:06:07.123Z"
    );
    // Space separator remains accepted and normalized.
    expect(parseHistoryDate("2026-03-04 05:06:07")?.toISOString()).toBe("2026-03-04T05:06:07.000Z");
  });

  it("honours an explicit offset", () => {
    expect(parseHistoryDate("2026-03-04T05:06:07+02:00")?.toISOString()).toBe(
      "2026-03-04T03:06:07.000Z"
    );
  });

  /**
   * Without this, `2026-03-04T05:06` is read in the server's local zone and the same
   * workbook imports to different instants on different machines.
   */
  it("treats a time with no offset as UTC, so the result cannot depend on the server", () => {
    expect(parseHistoryDate("2026-03-04T05:06")?.toISOString()).toBe("2026-03-04T05:06:00.000Z");
    expect(parseHistoryDate("2026-03-04T05:06:07")?.toISOString()).toBe("2026-03-04T05:06:07.000Z");
  });

  /**
   * Date does NOT reject an impossible calendar day: new Date("2026-02-30") rolls
   * over to 2026-03-02. A workbook typo would become a different, plausible,
   * immutable timestamp. The day is validated from the digits instead.
   */
  it("rejects an ISO-shaped but impossible date rather than rolling it over", () => {
    expect(parseHistoryDate("2026-02-30")).toBeNull();
    expect(parseHistoryDate("2026-13-01")).toBeNull();
    expect(parseHistoryDate("2026-04-31")).toBeNull();
    expect(parseHistoryDate("2026-01-00")).toBeNull();
  });

  it("gets leap years right", () => {
    // 2028 is a leap year, 2026 is not.
    expect(parseHistoryDate("2028-02-29")?.toISOString()).toBe("2028-02-29T00:00:00.000Z");
    expect(parseHistoryDate("2026-02-29")).toBeNull();
    // Century rule: 2000 was a leap year, 1900 was not.
    expect(parseHistoryDate("2000-02-29")?.toISOString()).toBe("2000-02-29T00:00:00.000Z");
    expect(parseHistoryDate("1900-02-29")).toBeNull();
  });

  it("rejects an impossible time", () => {
    expect(parseHistoryDate("2026-03-04T25:00")).toBeNull();
    expect(parseHistoryDate("2026-03-04T12:61")).toBeNull();
  });
});

describe("valuesEqual", () => {
  it("compares after trimming and whitespace normalization", () => {
    expect(valuesEqual("  Login   Module ", "Login Module")).toBe(true);
    expect(valuesEqual(1, "1")).toBe(true);
    expect(valuesEqual(null, "")).toBe(true);
  });

  it("remains case-sensitive", () => {
    expect(valuesEqual("High", "high")).toBe(false);
  });
});

describe("extractSettingsValues", () => {
  it("extracts the three independent value columns with source rows", () => {
    const rows: unknown[][] = [
      ["Priority", "Severity", "Result"],
      ["High", "Critical", "Pass"],
      ["Medium", "Major", "Fail"],
      ["Low", "Minor", "Blocked"],
      [null, null, null]
    ];
    const info = findHeaderRow(rows, SHEET_SPECS.settings);
    expect(info).not.toBeNull();
    if (!info) return;
    const values = extractSettingsValues(rows, info);
    expect(values).toHaveLength(9);
    expect(values).toContainEqual({ catalogue: "Priority", value: "High", sourceRow: 2 });
    expect(values).toContainEqual({ catalogue: "Result", value: "Blocked", sourceRow: 4 });
  });

  it("handles ragged columns (uneven list lengths)", () => {
    const rows: unknown[][] = [
      ["Priority", "Severity", "Result"],
      ["High", "Critical", "Pass"],
      [null, "Major", null]
    ];
    const info = findHeaderRow(rows, SHEET_SPECS.settings);
    expect(info).not.toBeNull();
    if (!info) return;
    const values = extractSettingsValues(rows, info);
    expect(values).toHaveLength(4);
    expect(values).toContainEqual({ catalogue: "Severity", value: "Major", sourceRow: 3 });
  });
});

describe("end-to-end through the real xlsx path", () => {
  it("parses a worksheet built with aoa_to_sheet", () => {
    const worksheet = XLSX.utils.aoa_to_sheet([
      ["Module inventory"],
      ["Module ID", "Product ID", "Module", "Notes"],
      ["MOD001", "PROD001", "Login", "extra ignored"],
      [],
      ["MOD002", "PROD001", null]
    ]);
    const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
      header: 1,
      defval: null,
      blankrows: true
    });
    const info = findHeaderRow(rows, SHEET_SPECS.moduleMaster);
    expect(info).not.toBeNull();
    if (!info) return;
    expect(info.headerRowIndex).toBe(1);
    expect(info.unknownColumns).toEqual(["Notes"]);
    const extracted = extractRows(rows, info, SHEET_SPECS.moduleMaster);
    expect(extracted.map((r) => r.kind)).toEqual(["COMPLETE", "BLANK", "PARTIAL"]);
    expect(extracted[0].values).toEqual({ "Module ID": "MOD001", "Product ID": "PROD001", Module: "Login" });
    expect(extracted[0].sourceRow).toBe(3);
  });
});
