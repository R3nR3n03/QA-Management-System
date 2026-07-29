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
