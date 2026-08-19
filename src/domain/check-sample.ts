/**
 * The sample results file offered from the automation checks screen.
 *
 * ## What it is for
 *
 * A reference, not a form. Nobody hand-authors a JUnit XML file — a test runner writes it —
 * so unlike the import workbook this is never filled in and handed back. Its job is to show
 * what ingestion reads: how a spec declares the test case it covers, and which element
 * produces which outcome.
 *
 * It is also safe to upload, and that is a deliberate property rather than a happy accident.
 * Every test in it names `TC-SAMPLE-0001`, an ID chosen not to collide rather than one that
 * cannot exist — nothing reserves a product tag, and `BUSINESS_ID_PATTERNS.testCase` would
 * accept a real one spelled this way. Where it resolves to nothing, uploading this file
 * writes a real check batch whose every row reports `REFERENCE_NOT_FOUND`: the pipeline is
 * demonstrated and not one observation is invented. A check answers "what did automation
 * last see here?" on a test case's screen, so a sample that fabricated an answer would be
 * lying in the one module built entirely around reporting rather than claiming (ADR-0008).
 *
 * ## Why this is written out rather than generated
 *
 * `import-template.ts` derives its headers from `SHEET_SPECS` — the same constant the parser
 * matches against — so that template cannot disagree with its parser. That reason does not
 * exist here. `parseJUnitXml` accepts a broad format and holds no constant describing a
 * well-formed file, so a data structure here would derive from nothing, while costing the
 * control over comments and indentation that makes the artifact worth reading. The interface
 * still matches the imports module; only the body differs.
 *
 * The guarantee is earned instead by `check-sample.test.ts`, which reads this file back
 * through `parseJUnitXml` and asserts every row it produces — so the commented claims below
 * cannot drift from what ingestion actually does with them.
 *
 * One deliberate omission: no `<failure>` here carries a `type` attribute. ADR-0010 records
 * that the type-attribute rule splitting Failed from Errored is unverified against a live
 * reporter, and an official sample demonstrating it would present it as settled. The test
 * asserts its absence.
 *
 * Pure: no Prisma, no filesystem, no session, no clock.
 */

/**
 * The test case every declared test in the sample names.
 *
 * Exported because the screen copy names it too, and a screen naming a different ID from
 * the file it links to would be wrong in a way nobody would notice. The test binds this
 * constant to the XML below; the screen binds its copy to this constant.
 */
export const SAMPLE_TEST_CASE_ID = "TC-SAMPLE-0001";

export const SAMPLE_RESULTS_FILENAME = "qams-check-sample.xml";

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<!--
  Sample results file for QAMS automation check ingestion.

  Your test runner writes this file - any runner that emits JUnit XML. It is a reference for
  what ingestion reads, not a file to fill in by hand.

  A real reporter also writes time, timestamp, and tests/failures/errors counts on the suite.
  QAMS reads none of them: every check in one file carries a single instant taken at
  ingestion, so those attributes are left out here rather than implying we keep them.

  Every test below names TC-SAMPLE-0001, which almost certainly resolves to nothing in your
  deployment. Uploading this file unchanged therefore writes no checks - each row reports
  Reference not found, which is a real batch and a safe way to see the plumbing work.
-->
<testsuites>
  <testsuite name="checkout/payment.cy.ts">

    <!-- Passed. A test reporting no failure, error or skip passed. -->
    <testcase name="TC-SAMPLE-0001 payment succeeds with a valid card" />

    <!-- Failed: an assertion did not hold. The reason is read from the message attribute. -->
    <testcase name="TC-SAMPLE-0001 the receipt shows the tax line">
      <failure message="expected total 100.00 to equal 112.00" />
    </testcase>

    <!-- Errored: the spec never reached an assertion. The reason is read from the element's
         own text, which is the other place a reporter puts it. Long reasons are truncated:
         QAMS records that a failure happened, never the evidence for it - the stack trace,
         the screenshot and the video stay in the run's own tooling. -->
    <testcase name="TC-SAMPLE-0001 a refund returns the full amount">
      <error>TimeoutError: timed out retrying after 4000ms waiting for .refund-confirmation</error>
    </testcase>

    <!-- Skipped: the spec did not run. -->
    <testcase name="TC-SAMPLE-0001 saved cards are offered at checkout">
      <skipped />
    </testcase>

    <!-- A test may declare its case on the class name instead of its own name. A describe
         block naming the case is a natural way to write a spec, so ingestion reads it. -->
    <testcase classname="TC-SAMPLE-0001 Card payment" name="rejects an expired card" />

    <!-- Declares no test case at all. Reported as such and creates no check, while every
         other row in the file is ingested - one mis-named spec must never discard a run's
         other results. -->
    <testcase name="the checkout page loads" />

    <!-- Suites nest to mirror nested describe blocks. A check is named for the suite that
         actually holds it, so this one's spec name is "3-D Secure" and not the file above. -->
    <testsuite name="3-D Secure">
      <testcase name="TC-SAMPLE-0001 a challenge is presented" />
    </testsuite>

  </testsuite>
</testsuites>
`;

/**
 * The sample results file as text, ready to stream as an .xml download.
 *
 * Newlines are normalized because the repository has no `.gitattributes` and `core.autocrlf`
 * is on: the literal above arrives CRLF on a Windows checkout and LF everywhere else, and
 * the bytes a person downloads should not depend on which machine served them.
 */
export function buildSampleResultsFile(): string {
  return SAMPLE_XML.replace(/\r\n/g, "\n");
}
