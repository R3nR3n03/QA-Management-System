import { describe, expect, it } from "vitest";
import { AppError } from "./errors";
import { ensureStepSequence, requireMaxLength } from "./validation";

/**
 * The first length rule in the system. It exists because an execution's purpose is a LIST
 * HEADLINE on `/executions` and `/my-work` (`docs/business-rules-and-validation.md`), unlike
 * every other free-text field here, which is only ever read on a detail page.
 */
describe("requireMaxLength", () => {
  it("accepts a value under the limit", () => {
    expect(() => requireMaxLength("Sprint 24 regression", 120, "purpose", "too long")).not.toThrow();
  });

  it("accepts a value exactly at the limit — the bound is inclusive", () => {
    expect(() => requireMaxLength("x".repeat(120), 120, "purpose", "too long")).not.toThrow();
  });

  it("rejects a value one character past the limit", () => {
    expect(() => requireMaxLength("x".repeat(121), 120, "purpose", "too long")).toThrowError(AppError);
  });

  it("measures the trimmed value — the domain stores it trimmed, so padding must not push it over", () => {
    expect(() => requireMaxLength(`  ${"x".repeat(120)}  `, 120, "purpose", "too long")).not.toThrow();
  });

  it("reports 422 ID_INVALID naming the field", () => {
    // Same code as the other text rules — a too-short password is `422 ID_INVALID` on a
    // field that is not an ID either (`docs/testing-and-acceptance.md`).
    try {
      requireMaxLength("x".repeat(121), 120, "purpose", "Purpose must be 120 characters or fewer.");
      expect.unreachable("expected requireMaxLength to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      const appError = error as AppError;
      expect(appError.status).toBe(422);
      expect(appError.code).toBe("ID_INVALID");
      expect(appError.field).toBe("purpose");
      expect(appError.message).toBe("Purpose must be 120 characters or fewer.");
    }
  });

  it("tolerates absence — requiring a value is `requireNonBlank`'s job, not this one's", () => {
    expect(() => requireMaxLength(undefined, 120, "purpose", "too long")).not.toThrow();
    expect(() => requireMaxLength(null, 120, "purpose", "too long")).not.toThrow();
  });
});

describe("ensureStepSequence", () => {
  it("accepts consecutive 1..n sequence", () => {
    expect(() => ensureStepSequence([{ sequence: 1 }, { sequence: 2 }, { sequence: 3 }])).not.toThrow();
  });

  it("rejects gaps", () => {
    expect(() => ensureStepSequence([{ sequence: 1 }, { sequence: 3 }])).toThrow();
  });
});
