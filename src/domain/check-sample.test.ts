import { CheckOutcome } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { BUSINESS_ID_PATTERNS } from "@/lib/business-ids";
import { parseJUnitXml } from "@/lib/junit-xml";
import { SAMPLE_RESULTS_FILENAME, SAMPLE_TEST_CASE_ID, buildSampleResultsFile } from "./check-sample";

/**
 * The sample is only worth offering if ingestion reads it the way the file's own comments
 * say it does, so these tests read the generated text back through the PARSER rather than
 * through any knowledge of how it was written. That closes the failure this file exists to
 * prevent: an official example that teaches the wrong thing.
 *
 * `import-template.test.ts` does the same for the workbook, for the same reason.
 */

const xml = buildSampleResultsFile();
const SPEC = "checkout/payment.cy.ts";

describe("sample results file", () => {
  it("is XML with a stable download name", () => {
    expect(SAMPLE_RESULTS_FILENAME).toBe("qams-check-sample.xml");
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    // Normalized on the way out: the bytes must not depend on the serving checkout.
    expect(xml).not.toContain("\r");
  });

  it("parses to exactly the rows its comments claim", () => {
    expect(parseJUnitXml(xml)).toEqual([
      {
        specName: SPEC,
        testName: "TC-SAMPLE-0001 payment succeeds with a valid card",
        businessId: SAMPLE_TEST_CASE_ID,
        outcome: CheckOutcome.PASSED,
        failureReason: null
      },
      {
        specName: SPEC,
        testName: "TC-SAMPLE-0001 the receipt shows the tax line",
        businessId: SAMPLE_TEST_CASE_ID,
        outcome: CheckOutcome.FAILED,
        // Read from the message attribute.
        failureReason: "expected total 100.00 to equal 112.00"
      },
      {
        specName: SPEC,
        testName: "TC-SAMPLE-0001 a refund returns the full amount",
        businessId: SAMPLE_TEST_CASE_ID,
        outcome: CheckOutcome.ERRORED,
        // Read from the element's own text, the other shape a reporter emits.
        failureReason: "TimeoutError: timed out retrying after 4000ms waiting for .refund-confirmation"
      },
      {
        specName: SPEC,
        testName: "TC-SAMPLE-0001 saved cards are offered at checkout",
        businessId: SAMPLE_TEST_CASE_ID,
        outcome: CheckOutcome.SKIPPED,
        failureReason: null
      },
      {
        specName: SPEC,
        // Declared on the class name rather than in the test name.
        testName: "rejects an expired card",
        businessId: SAMPLE_TEST_CASE_ID,
        outcome: CheckOutcome.PASSED,
        failureReason: null
      },
      {
        specName: SPEC,
        testName: "the checkout page loads",
        // The row that demonstrates NO_TEST_CASE_DECLARED.
        businessId: null,
        outcome: CheckOutcome.PASSED,
        failureReason: null
      },
      {
        // Named for the INNERMOST suite holding it, not for the file above.
        specName: "3-D Secure",
        testName: "TC-SAMPLE-0001 a challenge is presented",
        businessId: SAMPLE_TEST_CASE_ID,
        outcome: CheckOutcome.PASSED,
        failureReason: null
      }
    ]);
  });

  it("demonstrates every outcome ingestion records", () => {
    const outcomes = new Set(parseJUnitXml(xml).map((row) => row.outcome));
    expect(outcomes).toEqual(new Set(Object.values(CheckOutcome)));
  });

  it("never types a failure element", () => {
    // ADR-0010: the type-attribute rule that splits Failed from Errored is unverified
    // against a live reporter. Errored is demonstrated with <error>, which the format
    // itself defines. An edit that reintroduces a typed <failure> fails here.
    expect(/<failure\b[^>]*\btype=/.test(xml)).toBe(false);
    expect(xml).toContain("<error>");
  });

  it("declares one test case, and the screen copy names the same one", () => {
    const declared = parseJUnitXml(xml)
      .map((row) => row.businessId)
      .filter((id): id is string => id !== null);

    expect(new Set(declared)).toEqual(new Set([SAMPLE_TEST_CASE_ID]));
    // A legal business ID: chosen not to collide, not incapable of existing.
    expect(BUSINESS_ID_PATTERNS.testCase.test(SAMPLE_TEST_CASE_ID)).toBe(true);
  });
});
