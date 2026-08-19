import { describe, expect, it } from "vitest";
import { AppError } from "./errors";
import { MAX_FAILURE_REASON, parseJUnitXml } from "./junit-xml";

const doc = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>\n${body}`;

describe("parseJUnitXml", () => {
  it("reads a passing test, taking the test case business ID from its name", () => {
    const results = parseJUnitXml(
      doc(`
        <testsuites>
          <testsuite name="checkout.cy.ts">
            <testcase name="TC-PROD001-0001 guest can check out" classname="Checkout" />
          </testsuite>
        </testsuites>
      `)
    );

    expect(results).toEqual([
      {
        specName: "checkout.cy.ts",
        testName: "TC-PROD001-0001 guest can check out",
        businessId: "TC-PROD001-0001",
        outcome: "PASSED",
        failureReason: null
      }
    ]);
  });
  describe("outcome", () => {
    const one = (inner: string) =>
      parseJUnitXml(
        doc(`<testsuites><testsuite name="s.cy.ts"><testcase name="TC-PROD001-0001 t">${inner}</testcase></testsuite></testsuites>`)
      )[0];

    it("reads an assertion failure as FAILED, carrying the runner's message", () => {
      const check = one('<failure message="expected 3 to equal 4" type="AssertionError">at line 9</failure>');
      expect(check.outcome).toBe("FAILED");
      expect(check.failureReason).toBe("expected 3 to equal 4");
    });

    it("reads a failure that is NOT an assertion as ERRORED, because it blames the spec and not the software", () => {
      expect(one('<failure message="btn not found" type="CypressError">x</failure>').outcome).toBe("ERRORED");
    });

    it("reads an untyped failure as FAILED, honouring the element the format chose", () => {
      expect(one('<failure message="boom">x</failure>').outcome).toBe("FAILED");
    });

    it("reads an error element as ERRORED whatever its type says", () => {
      expect(one('<error message="setup died" type="AssertionError">x</error>').outcome).toBe("ERRORED");
    });

    it("reads a skipped test as SKIPPED and carries no reason", () => {
      const check = one("<skipped />");
      expect(check.outcome).toBe("SKIPPED");
      expect(check.failureReason).toBeNull();
    });

    it("falls back to the element's text when a failure carries no message attribute", () => {
      expect(one("<failure>the whole story</failure>").failureReason).toBe("the whole story");
    });
  });
  describe("what it refuses", () => {
    it("rejects a file that is not well-formed XML", () => {
      expect(() => parseJUnitXml("<testsuites><testsuite>")).toThrow(AppError);
      expect(() => parseJUnitXml("not xml at all")).toThrowError(/not a JUnit XML|could not be read/i);
    });

    it("rejects well-formed XML that carries no test suite at all", () => {
      expect(() => parseJUnitXml(doc("<report><runs>3</runs></report>"))).toThrow(AppError);
    });
  });

  describe("what it tolerates", () => {
    it("returns a null business ID for a test that declares none, rather than refusing the file", () => {
      const [check] = parseJUnitXml(
        doc('<testsuites><testsuite name="s"><testcase name="unmapped test" /></testsuite></testsuites>')
      );
      expect(check.businessId).toBeNull();
    });

    it("finds the business ID on the class name when the test name does not carry one", () => {
      const [check] = parseJUnitXml(
        doc('<testsuites><testsuite name="s"><testcase name="checks out" classname="TC-PROD001-0002 Checkout" /></testsuite></testsuites>')
      );
      expect(check.businessId).toBe("TC-PROD001-0002");
    });

    it("reads nested test suites, naming each check for the suite that holds it", () => {
      const checks = parseJUnitXml(
        doc(`<testsuites>
               <testsuite name="outer.cy.ts">
                 <testcase name="TC-PROD001-0001 a" />
                 <testsuite name="inner.cy.ts"><testcase name="TC-PROD001-0002 b" /></testsuite>
               </testsuite>
             </testsuites>`)
      );
      expect(checks.map((c) => [c.specName, c.businessId])).toEqual([
        ["outer.cy.ts", "TC-PROD001-0001"],
        ["inner.cy.ts", "TC-PROD001-0002"]
      ]);
    });

    it("reads a bare <testcase/> that carries neither attributes nor children", () => {
      // The parser hands back the empty STRING for such an element, not an object, so every
      // property test has to survive a primitive. Getting this wrong threw a raw TypeError
      // out of the parse, which reaches a caller as 500 rather than the documented 422.
      const checks = parseJUnitXml(doc('<testsuites><testsuite name="s"><testcase /></testsuite></testsuites>'));
      expect(checks).toEqual([
        { specName: "s", testName: "", businessId: null, outcome: "PASSED", failureReason: null }
      ]);
    });

    it("bounds a failure reason, so a stack trace cannot become the record", () => {
      const [check] = parseJUnitXml(
        doc(`<testsuites><testsuite name="s"><testcase name="TC-PROD001-0001 t"><failure>${"x".repeat(9000)}</failure></testcase></testsuite></testsuites>`)
      );
      expect(check.failureReason).toHaveLength(MAX_FAILURE_REASON);
    });
  });
});
