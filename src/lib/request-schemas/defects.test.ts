import { DefectLifecycleState } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { createDefectSchema, transitionDefectSchema, updateDefectDetailsSchema } from "./defects";
import { schemaIssueField } from "./issues";

describe("createDefectSchema", () => {
  const valid = {
    businessId: "BUG-0001",
    testCaseId: "test-case-1",
    summary: "Login fails for a valid user",
    priority: "High",
    severity: "Major"
  };

  it("accepts a complete body and keeps exactly the declared keys", () => {
    const result = createDefectSchema.safeParse(valid);

    expect(result.success).toBe(true);
    expect(Object.keys(result.data!).sort()).toEqual([
      "businessId",
      "priority",
      "severity",
      "summary",
      "testCaseId"
    ]);
  });

  it("accepts a body that omits priority and severity entirely", () => {
    // createDefect declares both optional (defects.ts:18) and persists `?? ""` at
    // defects.ts:43-44. The inline cast this schema replaced declared them required, which was
    // stricter than the service; copying it would have rejected bodies that work today.
    const { priority: _priority, severity: _severity, ...minimal } = valid;

    expect(createDefectSchema.safeParse(minimal).success).toBe(true);
  });

  it("permits a blank priority and severity", () => {
    // defects.ts:29-30 only consults the catalogue when the value is non-blank.
    expect(createDefectSchema.safeParse({ ...valid, priority: "" }).success).toBe(true);
    expect(createDefectSchema.safeParse({ ...valid, severity: "" }).success).toBe(true);
  });

  it("permits an omitted businessId — the server allocates one", () => {
    // docs/api-and-security.md:5 — optional, not forbidden.
    const { businessId: _businessId, ...withoutId } = valid;

    expect(createDefectSchema.safeParse(withoutId).success).toBe(true);
  });

  it("rejects a blank businessId and summary", () => {
    // Optional is not blank-tolerant: a supplied ID must still carry a value.
    expect(createDefectSchema.safeParse({ ...valid, businessId: "" }).success).toBe(false);
    expect(createDefectSchema.safeParse({ ...valid, summary: "" }).success).toBe(false);
  });

  it("permits a blank testCaseId", () => {
    // No blank guard; an unresolved id 404s at defects.ts:26-27.
    expect(createDefectSchema.safeParse({ ...valid, testCaseId: "" }).success).toBe(true);
  });

  it("rejects a smuggled status or version", () => {
    for (const key of ["status", "version", "createdBy"]) {
      const result = createDefectSchema.safeParse({ ...valid, [key]: "x" });

      expect(result.success).toBe(false);
      expect(schemaIssueField(result.error!.issues[0])).toBe(key);
    }
  });

  it("rejects a non-object body", () => {
    expect(createDefectSchema.safeParse(null).success).toBe(false);
    expect(createDefectSchema.safeParse([]).success).toBe(false);
  });
});

describe("updateDefectDetailsSchema", () => {
  const valid = { version: 1, summary: "Revised summary", priority: "Low", severity: "Minor" };

  it("accepts a complete body and keeps exactly the declared keys", () => {
    const result = updateDefectDetailsSchema.safeParse(valid);

    expect(result.success).toBe(true);
    expect(Object.keys(result.data!).sort()).toEqual(["priority", "severity", "summary", "version"]);
  });

  it("accepts an empty body — a missing version still yields 409 in the domain", () => {
    expect(updateDefectDetailsSchema.safeParse({}).success).toBe(true);
  });

  it("rejects a blank summary", () => {
    // requireNonBlankIfProvided at defects.ts:67.
    expect(updateDefectDetailsSchema.safeParse({ ...valid, summary: "" }).success).toBe(false);
  });

  it("permits a blank priority and severity", () => {
    // defects.ts:84-85 writes `input.priority?.trim() ?? current.priority`, so "" clears the
    // stored value, and :76-77 skips the catalogue check when blank.
    expect(updateDefectDetailsSchema.safeParse({ ...valid, priority: "" }).success).toBe(true);
    expect(updateDefectDetailsSchema.safeParse({ ...valid, severity: "" }).success).toBe(true);
  });

  it("rejects a smuggled status — status changes go through the transition route", () => {
    const result = updateDefectDetailsSchema.safeParse({ ...valid, status: "CLOSED" });

    expect(result.success).toBe(false);
    expect(schemaIssueField(result.error!.issues[0])).toBe("status");
  });
});

describe("transitionDefectSchema", () => {
  const valid = { version: 2, targetStatus: DefectLifecycleState.TRIAGED };

  it("accepts a minimal body and keeps exactly the declared keys", () => {
    const result = transitionDefectSchema.safeParse(valid);

    expect(result.success).toBe(true);
    expect(Object.keys(result.data!).sort()).toEqual(["targetStatus", "version"]);
  });

  it("accepts every real DefectLifecycleState as a targetStatus", () => {
    for (const state of Object.values(DefectLifecycleState)) {
      expect(transitionDefectSchema.safeParse({ version: 2, targetStatus: state }).success).toBe(true);
    }
  });

  it("rejects a bogus or omitted targetStatus", () => {
    // Today an arbitrary string reaches the Prisma enum column and fails there as a 500.
    const bogus = transitionDefectSchema.safeParse({ version: 2, targetStatus: "ARCHIVED" });

    expect(bogus.success).toBe(false);
    expect(schemaIssueField(bogus.error!.issues[0])).toBe("targetStatus");

    const omitted = transitionDefectSchema.safeParse({ version: 2 });

    expect(omitted.success).toBe(false);
    expect(schemaIssueField(omitted.error!.issues[0])).toBe("targetStatus");
  });

  it("accepts every optional reason field without requiring any of them", () => {
    // Which field is required depends on the source and target status; that conditional logic
    // is a business rule at defects.ts:150-174 and is deliberately not expressed here.
    const result = transitionDefectSchema.safeParse({
      version: 2,
      targetStatus: DefectLifecycleState.CLOSED,
      investigationOwnerId: "user-1",
      resolutionSummary: "Patched",
      retestEvidenceRef: "EVID-1",
      closureRationale: "Verified in UAT",
      reopenReason: "n/a"
    });

    expect(result.success).toBe(true);
    expect(Object.keys(result.data!).sort()).toEqual([
      "closureRationale",
      "investigationOwnerId",
      "reopenReason",
      "resolutionSummary",
      "retestEvidenceRef",
      "targetStatus",
      "version"
    ]);
  });

  it("permits a blank value on every conditional reason field", () => {
    // requireNonBlank in the domain (defects.ts:151,159,173) rejects blanks only for the
    // transitions that need them; rejecting "" here would apply the rule to every transition.
    for (const key of [
      "investigationOwnerId",
      "resolutionSummary",
      "retestEvidenceRef",
      "closureRationale",
      "reopenReason"
    ]) {
      expect(transitionDefectSchema.safeParse({ ...valid, [key]: "" }).success).toBe(true);
    }
  });

  it("accepts reopenReason even though the domain never persists it", () => {
    // Audit §3.4 (out of scope): transitionDefect validates reopenReason but omits it from the
    // update payload. Dropping it from the schema would turn a working reopen into a 422.
    const result = transitionDefectSchema.safeParse({
      version: 2,
      targetStatus: DefectLifecycleState.IN_PROGRESS,
      reopenReason: "Regression seen in UAT"
    });

    expect(result.success).toBe(true);
  });

  it("rejects a smuggled defectId or status", () => {
    expect(transitionDefectSchema.safeParse({ ...valid, defectId: "other" }).success).toBe(false);
    expect(transitionDefectSchema.safeParse({ ...valid, status: "CLOSED" }).success).toBe(false);
  });
});
