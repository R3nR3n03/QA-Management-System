import { ExecutionOutcome } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  createExecutionSchema,
  finalizeExecutionSchema,
  startExecutionSchema,
  updateExecutionSchema
} from "./executions";
import { schemaIssueField } from "./issues";

describe("createExecutionSchema", () => {
  const valid = { businessId: "EXE-0001", testCaseId: "test-case-1", testerId: "user-1" };

  it("accepts a valid body and keeps exactly the declared keys", () => {
    const result = createExecutionSchema.safeParse(valid);

    expect(result.success).toBe(true);
    expect(Object.keys(result.data!).sort()).toEqual(["businessId", "testCaseId", "testerId"]);
  });

  it("rejects a blank businessId", () => {
    // requireNonBlank at executions.ts:22.
    expect(createExecutionSchema.safeParse({ ...valid, businessId: "" }).success).toBe(false);
  });

  it("permits a blank testCaseId and testerId", () => {
    // No blank guard: an unresolved test case 404s at executions.ts:25-26 and an unresolved
    // tester 422s REFERENCE_INACTIVE at executions.ts:31-34. Tightening either would change
    // the error code a caller sees today.
    expect(createExecutionSchema.safeParse({ ...valid, testCaseId: "" }).success).toBe(true);
    expect(createExecutionSchema.safeParse({ ...valid, testerId: "" }).success).toBe(true);
  });

  it("rejects a smuggled state or result", () => {
    for (const key of ["state", "result", "version", "createdBy"]) {
      const result = createExecutionSchema.safeParse({ ...valid, [key]: "x" });

      expect(result.success).toBe(false);
      expect(schemaIssueField(result.error!.issues[0])).toBe(key);
    }
  });

  it("rejects a non-object body", () => {
    expect(createExecutionSchema.safeParse(null).success).toBe(false);
    expect(createExecutionSchema.safeParse([]).success).toBe(false);
  });
});

describe("updateExecutionSchema", () => {
  const valid = { testerId: "user-2", version: 1 };

  it("accepts a valid body and keeps exactly the declared keys", () => {
    const result = updateExecutionSchema.safeParse(valid);

    expect(result.success).toBe(true);
    expect(Object.keys(result.data!).sort()).toEqual(["testerId", "version"]);
  });

  it("rejects an omitted testerId — reassignment is the only thing this endpoint does", () => {
    const result = updateExecutionSchema.safeParse({ version: 1 });

    expect(result.success).toBe(false);
    expect(schemaIssueField(result.error!.issues[0])).toBe("testerId");
  });

  it("permits a blank testerId", () => {
    // No blank guard: an unresolved tester 422s REFERENCE_INACTIVE in the domain, matching
    // createExecution's error for the same field.
    expect(updateExecutionSchema.safeParse({ ...valid, testerId: "" }).success).toBe(true);
  });

  it("accepts an omitted version — a missing version still yields 409 in the domain", () => {
    expect(updateExecutionSchema.safeParse({ testerId: "user-2" }).success).toBe(true);
  });

  it("rejects a smuggled state, result or testCaseId", () => {
    // Lifecycle moves only through the explicit start/finalize endpoints, and a run is never
    // repointed at a different case.
    for (const key of ["state", "result", "testCaseId", "createdBy"]) {
      const result = updateExecutionSchema.safeParse({ ...valid, [key]: "x" });

      expect(result.success).toBe(false);
      expect(schemaIssueField(result.error!.issues[0])).toBe(key);
    }
  });

  it("rejects a non-object body", () => {
    expect(updateExecutionSchema.safeParse(null).success).toBe(false);
    expect(updateExecutionSchema.safeParse([]).success).toBe(false);
  });
});

describe("startExecutionSchema", () => {
  it("accepts a version and nothing else", () => {
    const result = startExecutionSchema.safeParse({ version: 1 });

    expect(result.success).toBe(true);
    expect(Object.keys(result.data!).sort()).toEqual(["version"]);
  });

  it("accepts an empty body — a missing version still yields 409 in the domain", () => {
    expect(startExecutionSchema.safeParse({}).success).toBe(true);
  });

  it("rejects a non-numeric version and a smuggled state", () => {
    expect(startExecutionSchema.safeParse({ version: "1" }).success).toBe(false);
    expect(startExecutionSchema.safeParse({ version: 1, state: "FINALIZED" }).success).toBe(false);
  });

  it("rejects a non-object body", () => {
    expect(startExecutionSchema.safeParse(null).success).toBe(false);
  });
});

describe("finalizeExecutionSchema", () => {
  const valid = {
    version: 3,
    result: ExecutionOutcome.PASS,
    actualResult: "The dashboard was displayed"
  };

  it("accepts a minimal body and keeps exactly the declared keys", () => {
    const result = finalizeExecutionSchema.safeParse(valid);

    expect(result.success).toBe(true);
    expect(Object.keys(result.data!).sort()).toEqual(["actualResult", "result", "version"]);
  });

  it("accepts every real ExecutionOutcome", () => {
    for (const outcome of Object.values(ExecutionOutcome)) {
      expect(finalizeExecutionSchema.safeParse({ ...valid, result: outcome }).success).toBe(true);
    }
  });

  it("rejects a bogus or omitted result", () => {
    // Today an arbitrary string reaches the Prisma enum column and fails there as a 500.
    const bogus = finalizeExecutionSchema.safeParse({ ...valid, result: "PARTIAL" });

    expect(bogus.success).toBe(false);
    expect(schemaIssueField(bogus.error!.issues[0])).toBe("result");

    const { result: _result, ...withoutResult } = valid;
    const omitted = finalizeExecutionSchema.safeParse(withoutResult);

    expect(omitted.success).toBe(false);
    expect(schemaIssueField(omitted.error!.issues[0])).toBe("result");
  });

  it("rejects a blank or omitted actualResult", () => {
    // requireNonBlank at executions.ts:118.
    expect(finalizeExecutionSchema.safeParse({ ...valid, actualResult: "" }).success).toBe(false);

    const { actualResult: _actualResult, ...withoutActual } = valid;

    expect(finalizeExecutionSchema.safeParse(withoutActual).success).toBe(false);
  });

  it("permits a blank blockReason and defectId", () => {
    // blockReason is required only for BLOCKED (executions.ts:128-130) and defectId only for
    // FAIL without createDefect (:131-133); both are conditional business rules, not shape.
    expect(finalizeExecutionSchema.safeParse({ ...valid, blockReason: "" }).success).toBe(true);
    expect(finalizeExecutionSchema.safeParse({ ...valid, defectId: "" }).success).toBe(true);
  });

  it("accepts a PASS body carrying createDefect, leaving that rule to the domain", () => {
    // executions.ts:134-136 rejects Pass-plus-new-defect with FORBIDDEN_TRANSITION. Encoding
    // it as a schema rule would move a business rule out of the domain layer and change the
    // error code.
    const result = finalizeExecutionSchema.safeParse({
      ...valid,
      createDefect: { businessId: "BUG-0002", summary: "Broken" }
    });

    expect(result.success).toBe(true);
  });

  it("accepts a nested createDefect without priority or severity", () => {
    // executions.ts:142/:145 already guard both with `?.`, and the sibling POST /defects path
    // permits omission (defects.ts:43-44). Requiring them here would forbid via finalize what
    // direct defect creation allows.
    const result = finalizeExecutionSchema.safeParse({
      ...valid,
      result: ExecutionOutcome.FAIL,
      createDefect: { businessId: "BUG-0002", summary: "Login fails" }
    });

    expect(result.success).toBe(true);
    expect(Object.keys(result.data!.createDefect!).sort()).toEqual(["businessId", "summary"]);
  });

  it("permits a blank priority and severity inside createDefect", () => {
    const result = finalizeExecutionSchema.safeParse({
      ...valid,
      result: ExecutionOutcome.FAIL,
      createDefect: { businessId: "BUG-0002", summary: "Login fails", priority: "", severity: "" }
    });

    expect(result.success).toBe(true);
  });

  it("rejects a blank businessId or summary inside createDefect and names the path", () => {
    // requireNonBlank at executions.ts:139-140.
    const blankId = finalizeExecutionSchema.safeParse({
      ...valid,
      createDefect: { businessId: "", summary: "Login fails" }
    });

    expect(blankId.success).toBe(false);
    expect(schemaIssueField(blankId.error!.issues[0])).toBe("createDefect.businessId");

    const blankSummary = finalizeExecutionSchema.safeParse({
      ...valid,
      createDefect: { businessId: "BUG-0002", summary: "" }
    });

    expect(blankSummary.success).toBe(false);
    expect(schemaIssueField(blankSummary.error!.issues[0])).toBe("createDefect.summary");
  });

  it("rejects an unrecognized key inside createDefect", () => {
    // The nested object is strict too: testCaseId is taken from the execution, never the body.
    const result = finalizeExecutionSchema.safeParse({
      ...valid,
      createDefect: { businessId: "BUG-0002", summary: "Login fails", testCaseId: "other-case" }
    });

    expect(result.success).toBe(false);
    expect(result.error!.issues[0].code).toBe("unrecognized_keys");
  });

  it("rejects a smuggled state or finalizedAt", () => {
    expect(finalizeExecutionSchema.safeParse({ ...valid, state: "FINALIZED" }).success).toBe(false);
    expect(finalizeExecutionSchema.safeParse({ ...valid, finalizedAt: "2026-01-01" }).success).toBe(false);
  });

  it("accepts an omitted version — a missing version still yields 409 in the domain", () => {
    const { version: _version, ...withoutVersion } = valid;

    expect(finalizeExecutionSchema.safeParse(withoutVersion).success).toBe(true);
  });
});
