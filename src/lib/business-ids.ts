import { AppError } from "./errors";

export const BUSINESS_ID_PATTERNS = {
  product: /^PROD\d{3}$/,
  module: /^MOD\d{3}$/,
  feature: /^FEAT\d{3}$/,
  requirement: /^REQ\d{3}$/,
  testCase: /^TC-[A-Za-z0-9]+-\d{4}$/,
  execution: /^EXE-\d{4}$/,
  defect: /^BUG-\d{4}$/
} as const;

export function ensureBusinessIdFormat(
  value: string,
  pattern: RegExp,
  field: string,
  documentedFormat: string
) {
  if (!pattern.test(value.trim())) {
    throw new AppError(422, "ID_INVALID", `${field} must match the documented format ${documentedFormat}.`, field);
  }
}

/**
 * A test case business ID found ANYWHERE in a string, rather than anchored like the
 * pattern above. An automation spec declares the case it covers by naming it in its own
 * test name (ADR-0009), so ingestion has to find one inside a sentence rather than
 * validate a whole field.
 *
 * Kept beside `BUSINESS_ID_PATTERNS.testCase` on purpose: the two must agree on what a
 * test case ID looks like, and they will only stay in step if a reader can see both at
 * once.
 */
export const TEST_CASE_ID_IN_TEXT = /TC-[A-Za-z0-9]+-\d{4}/;
