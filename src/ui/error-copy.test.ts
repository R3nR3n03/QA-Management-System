import { describe, expect, it } from "vitest";
import { coveredCodes, errorCopy } from "./error-copy";

const ALL_ERROR_CODES = [
  "ID_INVALID",
  "ID_DUPLICATE",
  "REFERENCE_NOT_FOUND",
  "REFERENCE_INACTIVE",
  "HIERARCHY_MISMATCH",
  "CONTROLLED_VALUE_INVALID",
  "VERSION_CONFLICT",
  "ROW_INCOMPLETE",
  "RECONCILIATION_REQUIRED",
  "POLICY_NOT_DEFINED",
  "FORBIDDEN_TRANSITION",
  "UNAUTHORIZED",
  "INTERNAL_ERROR"
].sort();

describe("errorCopy", () => {
  // If src/lib/errors.ts gains a code and this module does not, a user would be
  // shown a raw identifier. This is the assertion that stops that shipping.
  it("covers every code in the ErrorCode union", () => {
    expect(coveredCodes()).toEqual(ALL_ERROR_CODES);
  });

  it("never leaks a raw code into user-facing text", () => {
    for (const code of ALL_ERROR_CODES) {
      const copy = errorCopy(code);
      expect(copy.title).not.toContain("_");
      expect(copy.title.length).toBeGreaterThan(0);
    }
  });

  it("falls back to the internal-error wording for an unknown code", () => {
    expect(errorCopy("SOMETHING_NEW").title).toBe(errorCopy("INTERNAL_ERROR").title);
  });

  it("prefers field-specific copy when a field is supplied", () => {
    const generic = errorCopy("ID_INVALID");
    const specific = errorCopy("ID_INVALID", "businessId");
    expect(specific.title).not.toBe(generic.title);
    expect(specific.detail).toContain("PROD001");
  });

  it("falls back to the code's general copy for a field with no override", () => {
    expect(errorCopy("ID_INVALID", "somethingUnmapped").title).toBe(errorCopy("ID_INVALID").title);
  });

  // docs/business-rules-and-validation.md:38 - POLICY_NOT_DEFINED reports that the
  // knowledge base establishes nothing here. It is not a failure and must not be
  // rendered as one.
  it("marks POLICY_NOT_DEFINED as advisory and nothing else", () => {
    expect(errorCopy("POLICY_NOT_DEFINED").advisory).toBe(true);
    const others = ALL_ERROR_CODES.filter((c) => c !== "POLICY_NOT_DEFINED");
    for (const code of others) {
      expect(errorCopy(code).advisory).toBeUndefined();
    }
  });

  it("tells the user their work is safe on a version conflict", () => {
    expect(errorCopy("VERSION_CONFLICT").detail).toContain("Nothing you typed has been lost");
  });

  it("states that nothing was saved when the server failed", () => {
    expect(errorCopy("INTERNAL_ERROR").detail).toContain("Nothing was saved");
  });

  it("does not name a role in the UNAUTHORIZED wording", () => {
    // api-and-security.md:33 forbids exposing authorization rules. Whether a UI may
    // name the role that IS permitted is an open QA Lead question (audit 5.10), so
    // the shipped default stays neutral until that is settled.
    const copy = errorCopy("UNAUTHORIZED");
    for (const role of ["QA_TESTER", "QA_ENGINEER", "SENIOR_QA_ENGINEER", "QA_LEAD", "Senior QA"]) {
      expect(`${copy.title} ${copy.detail}`).not.toContain(role);
    }
  });
});
