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
  const valid = { businessId: "EXE-0001", testCaseIds: ["test-case-1", "test-case-2"], testerId: "user-1" };

  it("accepts a valid body and keeps exactly the declared keys", () => {
    const result = createExecutionSchema.safeParse(valid);

    expect(result.success).toBe(true);
    expect(Object.keys(result.data!).sort()).toEqual(["businessId", "testCaseIds", "testerId"]);
  });

  it("accepts a single-case selection — one case is the lower bound, not the shape", () => {
    expect(createExecutionSchema.safeParse({ ...valid, testCaseIds: ["test-case-1"] }).success).toBe(true);
  });

  it("permits an omitted businessId — the server allocates one", () => {
    // docs/api-and-security.md:5 — optional, not forbidden.
    const { businessId: _businessId, ...withoutId } = valid;

    expect(createExecutionSchema.safeParse(withoutId).success).toBe(true);
  });

  it("rejects a blank businessId", () => {
    // Optional is not blank-tolerant: a supplied ID must still carry a value.
    expect(createExecutionSchema.safeParse({ ...valid, businessId: "" }).success).toBe(false);
  });

  it("rejects an empty testCaseIds array — an execution covers one or more cases", () => {
    // The domain re-checks at executions.ts:31-33 for callers that bypass this schema.
    const result = createExecutionSchema.safeParse({ ...valid, testCaseIds: [] });

    expect(result.success).toBe(false);
    expect(schemaIssueField(result.error!.issues[0])).toBe("testCaseIds");
  });

  it("rejects a duplicated test case id — each case may be selected only once", () => {
    // Mirrors executions.ts:34-36; the unique constraint on (executionId, testCaseId)
    // is the database's final safeguard.
    const result = createExecutionSchema.safeParse({
      ...valid,
      testCaseIds: ["test-case-1", "test-case-1"]
    });

    expect(result.success).toBe(false);
    expect(schemaIssueField(result.error!.issues[0])).toBe("testCaseIds");
  });

  it("rejects a scalar testCaseId — the single-case field is gone", () => {
    const result = createExecutionSchema.safeParse({
      businessId: "EXE-0001",
      testCaseId: "test-case-1",
      testerId: "user-1"
    });

    expect(result.success).toBe(false);
  });

  it("permits a blank id inside testCaseIds and a blank testerId", () => {
    // No blank guard: an unresolved test case 404s at executions.ts:42-44 and an unresolved
    // tester 422s REFERENCE_INACTIVE at executions.ts:50-53. Tightening either would change
    // the error code a caller sees today.
    expect(createExecutionSchema.safeParse({ ...valid, testCaseIds: [""] }).success).toBe(true);
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

  it("rejects a smuggled state, result or testCaseIds", () => {
    // Lifecycle moves only through the explicit start/finalize endpoints, and a run is never
    // repointed at different cases.
    for (const key of ["state", "result", "testCaseIds", "createdBy"]) {
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
  const passEntry = {
    testCaseId: "test-case-1",
    result: ExecutionOutcome.PASS,
    actualResult: "The dashboard was displayed"
  };
  const valid = { version: 3, results: [passEntry] };

  it("accepts a minimal body and keeps exactly the declared keys", () => {
    const result = finalizeExecutionSchema.safeParse(valid);

    expect(result.success).toBe(true);
    expect(Object.keys(result.data!).sort()).toEqual(["results", "version"]);
    expect(Object.keys(result.data!.results[0]).sort()).toEqual(["actualResult", "result", "testCaseId"]);
  });

  it("accepts several per-case entries in one request — all results arrive together", () => {
    // Whether the entries cover the execution's case set exactly once is checked against
    // the database at executions.ts:225-238, not here.
    const result = finalizeExecutionSchema.safeParse({
      version: 3,
      results: [
        passEntry,
        { testCaseId: "test-case-2", result: ExecutionOutcome.BLOCKED, actualResult: "Env down", blockReason: "VPN outage" }
      ]
    });

    expect(result.success).toBe(true);
  });

  it("rejects an empty results array — an empty list can never cover the case set", () => {
    const result = finalizeExecutionSchema.safeParse({ version: 3, results: [] });

    expect(result.success).toBe(false);
    expect(schemaIssueField(result.error!.issues[0])).toBe("results");
  });

  it("rejects the old flat single-case shape", () => {
    const result = finalizeExecutionSchema.safeParse({
      version: 3,
      result: ExecutionOutcome.PASS,
      actualResult: "The dashboard was displayed"
    });

    expect(result.success).toBe(false);
  });

  it("accepts every real ExecutionOutcome", () => {
    for (const outcome of Object.values(ExecutionOutcome)) {
      const result = finalizeExecutionSchema.safeParse({
        version: 3,
        results: [{ ...passEntry, result: outcome }]
      });

      expect(result.success).toBe(true);
    }
  });

  it("rejects a bogus or omitted per-case result", () => {
    // An arbitrary string would reach the Prisma enum column and fail there as a 500.
    const bogus = finalizeExecutionSchema.safeParse({
      version: 3,
      results: [{ ...passEntry, result: "PARTIAL" }]
    });

    expect(bogus.success).toBe(false);

    const { result: _result, ...withoutResult } = passEntry;
    const omitted = finalizeExecutionSchema.safeParse({ version: 3, results: [withoutResult] });

    expect(omitted.success).toBe(false);
  });

  it("rejects a blank or omitted per-case actualResult", () => {
    // requireNonBlank per case at executions.ts:244.
    expect(
      finalizeExecutionSchema.safeParse({ version: 3, results: [{ ...passEntry, actualResult: "" }] }).success
    ).toBe(false);

    const { actualResult: _actualResult, ...withoutActual } = passEntry;

    expect(finalizeExecutionSchema.safeParse({ version: 3, results: [withoutActual] }).success).toBe(false);
  });

  it("permits a blank blockReason and defectId", () => {
    // blockReason is required only for a BLOCKED case (executions.ts:246-248) and defectId
    // only for a FAIL without createDefect (:249-251); both are conditional business rules,
    // not shape.
    expect(
      finalizeExecutionSchema.safeParse({ version: 3, results: [{ ...passEntry, blockReason: "" }] }).success
    ).toBe(true);
    expect(
      finalizeExecutionSchema.safeParse({ version: 3, results: [{ ...passEntry, defectId: "" }] }).success
    ).toBe(true);
  });

  it("accepts a PASS entry carrying createDefect, leaving that rule to the domain", () => {
    // executions.ts:252-254 rejects Pass-plus-new-defect with FORBIDDEN_TRANSITION. Encoding
    // it as a schema rule would move a business rule out of the domain layer and change the
    // error code.
    const result = finalizeExecutionSchema.safeParse({
      version: 3,
      results: [{ ...passEntry, createDefect: { businessId: "BUG-0002", summary: "Broken" } }]
    });

    expect(result.success).toBe(true);
  });

  it("accepts a nested createDefect without priority or severity", () => {
    // executions.ts:260/:263 already guard both with `?.`, and the sibling POST /defects path
    // permits omission (defects.ts:43-44). Requiring them here would forbid via finalize what
    // direct defect creation allows.
    const result = finalizeExecutionSchema.safeParse({
      version: 3,
      results: [
        {
          ...passEntry,
          result: ExecutionOutcome.FAIL,
          createDefect: { businessId: "BUG-0002", summary: "Login fails" }
        }
      ]
    });

    expect(result.success).toBe(true);
    expect(Object.keys(result.data!.results[0].createDefect!).sort()).toEqual(["businessId", "summary"]);
  });

  it("permits an omitted businessId inside createDefect — the finalize tx allocates it", () => {
    // docs/api-and-security.md:5 — several ID-less entries in one request draw distinct
    // BUG-#### numbers from the locked counter. Blank is still rejected.
    const result = finalizeExecutionSchema.safeParse({
      version: 3,
      results: [
        { ...passEntry, result: ExecutionOutcome.FAIL, createDefect: { summary: "Login fails" } }
      ]
    });

    expect(result.success).toBe(true);
    expect(
      finalizeExecutionSchema.safeParse({
        version: 3,
        results: [
          { ...passEntry, result: ExecutionOutcome.FAIL, createDefect: { businessId: "", summary: "x" } }
        ]
      }).success
    ).toBe(false);
  });

  it("permits a blank priority and severity inside createDefect", () => {
    const result = finalizeExecutionSchema.safeParse({
      version: 3,
      results: [
        {
          ...passEntry,
          result: ExecutionOutcome.FAIL,
          createDefect: { businessId: "BUG-0002", summary: "Login fails", priority: "", severity: "" }
        }
      ]
    });

    expect(result.success).toBe(true);
  });

  it("rejects a blank businessId or summary inside createDefect", () => {
    // requireNonBlank at executions.ts:257-258.
    const blankId = finalizeExecutionSchema.safeParse({
      version: 3,
      results: [{ ...passEntry, createDefect: { businessId: "", summary: "Login fails" } }]
    });

    expect(blankId.success).toBe(false);

    const blankSummary = finalizeExecutionSchema.safeParse({
      version: 3,
      results: [{ ...passEntry, createDefect: { businessId: "BUG-0002", summary: "" } }]
    });

    expect(blankSummary.success).toBe(false);
  });

  it("rejects an unrecognized key inside a result entry and inside createDefect", () => {
    // Both nested objects are strict too: a per-case entry carries no lifecycle fields, and
    // createDefect's testCaseId is taken from the entry, never the body.
    const entryKey = finalizeExecutionSchema.safeParse({
      version: 3,
      results: [{ ...passEntry, state: "FINALIZED" }]
    });

    expect(entryKey.success).toBe(false);
    expect(entryKey.error!.issues[0].code).toBe("unrecognized_keys");

    const defectKey = finalizeExecutionSchema.safeParse({
      version: 3,
      results: [
        {
          ...passEntry,
          createDefect: { businessId: "BUG-0002", summary: "Login fails", testCaseId: "other-case" }
        }
      ]
    });

    expect(defectKey.success).toBe(false);
    expect(defectKey.error!.issues[0].code).toBe("unrecognized_keys");
  });

  it("rejects a smuggled top-level state or finalizedAt", () => {
    expect(finalizeExecutionSchema.safeParse({ ...valid, state: "FINALIZED" }).success).toBe(false);
    expect(finalizeExecutionSchema.safeParse({ ...valid, finalizedAt: "2026-01-01" }).success).toBe(false);
  });

  it("accepts an omitted version — a missing version still yields 409 in the domain", () => {
    expect(finalizeExecutionSchema.safeParse({ results: [passEntry] }).success).toBe(true);
  });
});
