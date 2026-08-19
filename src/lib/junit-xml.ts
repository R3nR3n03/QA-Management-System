import { CheckOutcome } from "@prisma/client";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { TEST_CASE_ID_IN_TEXT } from "./business-ids";
import { AppError } from "./errors";

/**
 * One `<testcase>` from a JUnit XML results file, read into the shape a check is written
 * from. Pure: no database, no clock, no configuration.
 */
export type ParsedCheck = {
  specName: string;
  testName: string;
  /** The test case this test declared it covers, or null where it declared none. */
  businessId: string | null;
  outcome: CheckOutcome;
  failureReason: string | null;
};

/**
 * How much of a runner's failure message is kept.
 *
 * A reason is a pointer, not evidence: the run's own tooling holds the stack trace, the
 * screenshot and the video, and `architecture.md` is explicit that QAMS records that a
 * failure happened rather than the evidence for it. Without a bound, one crashing suite
 * writes megabytes of stack traces into a column a screen renders.
 */
export const MAX_FAILURE_REASON = 2000;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  // Values arrive exactly as written. Without these a test named "0001" parses as the
  // number 1, and a business ID is text that happens to contain digits.
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true
});

function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function attr(node: Record<string, unknown>, name: string): string | null {
  const raw = node[`@_${name}`];
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

/** The element's own text content, which carries the detail when no message attribute does. */
function text(node: Record<string, unknown>): string | null {
  const raw = node["#text"];
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

/**
 * Which outcome one `<testcase>` reports, and why the rule is shaped this way.
 *
 * The format offers three shapes — `<failure>`, `<error>`, `<skipped>` — and its own
 * semantics say a failure is an assertion that did not hold while an error is anything
 * else. Trust that, EXCEPT where a failure's `type` attribute contradicts it: Cypress's
 * usual reporter (`mocha-junit-reporter`) emits `<failure>` for both, so the type is the
 * only discriminator available on the path this feature was built for (ADR-0010).
 *
 * An untyped `<failure>` stays FAILED. That is the element the format itself chose, and
 * guessing ERRORED against it would quietly stop reporting real failures — the direction
 * that loses a bug, rather than the direction that wastes an hour.
 */
function readOutcome(test: Record<string, unknown>): { outcome: CheckOutcome; reason: string | null } {
  // A `<testcase/>` with neither attributes nor children parses to the empty STRING rather
  // than an object, so `in` below would throw on a primitive. A test that reports nothing
  // reports no failure, which is a pass.
  if (typeof test !== "object" || test === null) return { outcome: CheckOutcome.PASSED, reason: null };

  if ("skipped" in test) return { outcome: CheckOutcome.SKIPPED, reason: null };

  for (const element of ["error", "failure"] as const) {
    if (!(element in test)) continue;

    // An element carrying text but no attributes parses to a bare string rather than an
    // object, so the two shapes have to be read differently to reach the same detail.
    const node = toArray(test[element] as unknown)[0];
    const detail = (typeof node === "object" && node !== null ? node : {}) as Record<string, unknown>;
    const raw =
      typeof node === "string" && node.length > 0 ? node : attr(detail, "message") ?? text(detail);
    const reason = raw === null ? null : raw.slice(0, MAX_FAILURE_REASON);

    if (element === "error") return { outcome: CheckOutcome.ERRORED, reason };

    const type = attr(detail, "type");
    const isAssertion = type === null || /assertion/i.test(type);
    return { outcome: isAssertion ? CheckOutcome.FAILED : CheckOutcome.ERRORED, reason };
  }

  return { outcome: CheckOutcome.PASSED, reason: null };
}

/**
 * Every `<testsuite>` in the document, nested ones included, each paired with the tests it
 * holds directly. JUnit nests suites to mirror nested `describe` blocks, and a check is
 * named for the suite that actually contains it rather than for the outermost one.
 */
function flattenSuites(nodes: Record<string, unknown>[]): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  for (const node of nodes) {
    found.push(node);
    found.push(...flattenSuites(toArray(node.testsuite as Record<string, unknown>[])));
  }
  return found;
}

/**
 * Read a JUnit XML results file.
 *
 * Refuses the whole file for a structural problem — unparseable, or carrying no test suite
 * at all — because a file QAMS cannot understand says nothing about any test case, and
 * ingesting part of it would be reporting a run that did not happen. It refuses nothing
 * for a *content* problem: a test declaring no business ID comes back with a null one and
 * is reported row by row, since one mis-named spec must never discard a run's other
 * results (`docs/api-and-security.md` § "Automation check ingestion interface").
 */
export function parseJUnitXml(xml: string): ParsedCheck[] {
  const valid = XMLValidator.validate(xml);
  if (valid !== true) {
    throw new AppError(422, "ID_INVALID", "The file could not be read as XML.", "file");
  }

  const parsed = parser.parse(xml) as Record<string, unknown>;
  const root = parsed.testsuites as Record<string, unknown> | undefined;
  const top = root
    ? toArray(root.testsuite as Record<string, unknown>[])
    : toArray(parsed.testsuite as Record<string, unknown>[]);

  if (top.length === 0) {
    throw new AppError(
      422,
      "ID_INVALID",
      "The file is not a JUnit XML results file: it contains no test suite.",
      "file"
    );
  }

  const checks: ParsedCheck[] = [];
  for (const suite of flattenSuites(top)) {
    const specName = attr(suite, "name") ?? "";
    for (const test of toArray(suite.testcase as Record<string, unknown>[])) {
      const testName = attr(test, "name") ?? "";
      const { outcome, reason } = readOutcome(test);
      // Name first, then class name. A spec declares its coverage in the test's own name
      // (ADR-0009), but a `describe` block naming the case puts it on the class name
      // instead, which is a natural way to write one and not worth refusing.
      const declared = testName.match(TEST_CASE_ID_IN_TEXT) ?? (attr(test, "classname") ?? "").match(TEST_CASE_ID_IN_TEXT);
      checks.push({
        specName,
        testName,
        businessId: declared?.[0] ?? null,
        outcome,
        failureReason: reason
      });
    }
  }
  return checks;
}
