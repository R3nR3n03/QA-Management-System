import { describe, expect, it } from "vitest";
import { CHECK_OUTCOME_LABEL, CHECK_OUTCOME_TONE } from "@/ui/check-outcome";
import {
  CHECK_FILINGS,
  OBSERVED_FILINGS,
  UNRESOLVED_FILINGS,
  filingFor,
  filingKeyOf
} from "./check-tone";

/**
 * Three screens read this one vocabulary — the batch list as count columns, the batch head as
 * filter slots, and a row as its own chip — so what is pinned here is that they cannot come
 * apart: the order is fixed, the two vocabularies are both reachable, and an outcome nobody
 * has taught this module about still renders as something rather than as a raw enum.
 */
describe("CHECK_FILINGS", () => {
  it("holds a fixed order, observed outcomes before the rows that reached nothing", () => {
    // Pinned as a literal, because the ORDER is the feature: it is what makes a column
    // scannable down the page and a filter slot findable between batches.
    expect(CHECK_FILINGS.map((f) => f.key)).toEqual([
      "PASSED",
      "FAILED",
      "ERRORED",
      "SKIPPED",
      "REFERENCE_NOT_FOUND",
      "NO_TEST_CASE_DECLARED"
    ]);
  });

  it("splits into the four a check records and the two that record none", () => {
    expect(OBSERVED_FILINGS.map((f) => f.key)).toEqual(["PASSED", "FAILED", "ERRORED", "SKIPPED"]);
    expect(UNRESOLVED_FILINGS.map((f) => f.key)).toEqual([
      "REFERENCE_NOT_FOUND",
      "NO_TEST_CASE_DECLARED"
    ]);
    // Every filing is in exactly one half. A future outcome that is neither would silently
    // vanish from both the columns and the summary.
    expect(OBSERVED_FILINGS.length + UNRESOLVED_FILINGS.length).toBe(CHECK_FILINGS.length);
  });

  it("takes the check vocabulary's own words and chips rather than restating them", () => {
    // If these ever diverge, `CheckOutcomeChip` and these screens are describing the same
    // observation with two different words.
    const passed = filingFor("PASSED");
    expect(passed.label).toBe(CHECK_OUTCOME_LABEL.PASSED);
    expect(passed.chip).toBe(CHECK_OUTCOME_TONE.PASSED);
  });

  it("keeps ERRORED apart from FAILED in the chip and in the slot", () => {
    // The one distinction these screens exist to preserve: a broken spec is not broken
    // software (`src/ui/check-outcome.ts`).
    expect(filingFor("ERRORED").chip).not.toBe(filingFor("FAILED").chip);
    expect(filingFor("ERRORED").slotTone).not.toBe(filingFor("FAILED").slotTone);
  });

  it("gives neither unresolved filing the tone of the row that worked", () => {
    const passed = filingFor("PASSED").chip;
    for (const filing of UNRESOLVED_FILINGS) expect(filing.chip).not.toBe(passed);
  });
});

describe("filingFor", () => {
  it("humanises an unknown key onto the neutral chip instead of printing the enum", () => {
    const unknown = filingFor("SOMETHING_NEW");
    expect(unknown.label).toBe("Something new");
    expect(unknown.chip).toBe("state");
    expect(unknown.slotTone).toBeUndefined();
    // Not counted as unresolved: nothing is known about it, and claiming it reached no test
    // case would put it in the summary sentence as a fact.
    expect(unknown.unresolved).toBe(false);
  });
});

describe("filingKeyOf", () => {
  it("files a created row under what the spec observed", () => {
    expect(filingKeyOf("CREATED", "FAILED")).toBe("FAILED");
  });

  it("files a row that created nothing under why", () => {
    expect(filingKeyOf("REFERENCE_NOT_FOUND", null)).toBe("REFERENCE_NOT_FOUND");
    expect(filingKeyOf("NO_TEST_CASE_DECLARED", null)).toBe("NO_TEST_CASE_DECLARED");
  });

  it("matches the rule the domain's tally uses", () => {
    // `tally` in `src/domain/checks.ts` keys `counts` this exact way. If the two drift, a chip
    // says one thing and the number counting it says another.
    const rows = [
      { outcome: "CREATED", checkOutcome: "PASSED" },
      { outcome: "CREATED", checkOutcome: "FAILED" },
      { outcome: "REFERENCE_NOT_FOUND", checkOutcome: null }
    ];
    expect(rows.map((r) => filingKeyOf(r.outcome, r.checkOutcome))).toEqual([
      "PASSED",
      "FAILED",
      "REFERENCE_NOT_FOUND"
    ]);
  });
});
