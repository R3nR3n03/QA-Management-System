import { TestCaseLifecycleState } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { buildTestCaseCreateData, type CreateTestCaseInput } from "./test-cases";

const actor = { userId: "user-author" };

// `businessId` is required here: buildTestCaseCreateData runs after createTestCase has
// resolved a supplied or generated ID, so its input always carries one.
function validInput(overrides: Partial<CreateTestCaseInput> = {}): CreateTestCaseInput & { businessId: string } {
  return {
    businessId: "TC-CRM-0001",
    productId: "product-1",
    moduleId: "module-1",
    featureId: "feature-1",
    requirementId: "requirement-1",
    cycle: "Cycle 1",
    sprint: "Sprint 3",
    release: "R2026.1",
    environment: "UAT",
    priority: "High",
    severity: "Major",
    title: "Login with valid credentials",
    objective: "Verify a registered user can sign in",
    expectedResult: "The dashboard is displayed",
    ...overrides
  };
}

describe("buildTestCaseCreateData", () => {
  it("returns exactly the allow-listed keys", () => {
    const result = buildTestCaseCreateData(validInput(), actor);

    // An exact key set is the regression guard: if the spread of the raw request body
    // ever returns, this list grows and the test fails.
    expect(Object.keys(result).sort()).toEqual(
      [
        "authorUserId",
        "businessId",
        "createdBy",
        "cycle",
        "environment",
        "expectedResult",
        "featureId",
        "lifecycleState",
        "moduleId",
        "objective",
        "priority",
        "productId",
        "release",
        "requirementId",
        "revisesTestCaseId",
        "severity",
        "sprint",
        "title",
        "updatedBy"
      ].sort()
    );
  });

  it("ignores every server-controlled field a caller tries to inject", () => {
    const hostile = {
      ...validInput(),
      id: "attacker-chosen-id",
      lifecycleState: "APPROVED",
      version: 99,
      reviewReason: "already reviewed",
      retirementReason: "retired",
      authorUserId: "someone-else",
      createdBy: "someone-else",
      updatedBy: "someone-else",
      createdAt: new Date(0),
      updatedAt: new Date(0)
    } as unknown as CreateTestCaseInput & { businessId: string };

    const result = buildTestCaseCreateData(hostile, actor);

    // The whole point of this function: a canAuthor user must not be able to mint an
    // Approved test case in one request and skip DRAFT -> IN_REVIEW -> APPROVED.
    expect(result.lifecycleState).toBe(TestCaseLifecycleState.DRAFT);
    expect(result.version).toBeUndefined();
    expect(result.reviewReason).toBeUndefined();
    expect(result.retirementReason).toBeUndefined();
    expect(result.id).toBeUndefined();
    expect(result.createdAt).toBeUndefined();
    expect(result.updatedAt).toBeUndefined();
  });

  it("forces lifecycleState to DRAFT even for an untampered body", () => {
    expect(buildTestCaseCreateData(validInput(), actor).lifecycleState).toBe(TestCaseLifecycleState.DRAFT);
  });

  it("stamps authorUserId, createdBy and updatedBy from the actor, never the input", () => {
    const hostile = {
      ...validInput(),
      authorUserId: "someone-else",
      createdBy: "someone-else",
      updatedBy: "someone-else"
    } as unknown as CreateTestCaseInput & { businessId: string };

    const result = buildTestCaseCreateData(hostile, actor);

    expect(result.authorUserId).toBe("user-author");
    expect(result.createdBy).toBe("user-author");
    expect(result.updatedBy).toBe("user-author");
  });

  it("carries revisesTestCaseId through when present", () => {
    const result = buildTestCaseCreateData(validInput({ revisesTestCaseId: "prior-case-id" }), actor);

    expect(result.revisesTestCaseId).toBe("prior-case-id");
  });

  it("leaves revisesTestCaseId undefined when absent", () => {
    expect(buildTestCaseCreateData(validInput(), actor).revisesTestCaseId).toBeUndefined();
  });

  it("trims every string field, not only the four previously trimmed", () => {
    const padded = validInput({
      businessId: "  TC-CRM-0001  ",
      cycle: "  Cycle 1  ",
      sprint: "  Sprint 3  ",
      release: "  R2026.1  ",
      environment: "  UAT  ",
      priority: "  High  ",
      severity: "  Major  ",
      title: "  Login with valid credentials  ",
      objective: "  Verify a registered user can sign in  ",
      expectedResult: "  The dashboard is displayed  "
    });

    const result = buildTestCaseCreateData(padded, actor);

    expect(result.businessId).toBe("TC-CRM-0001");
    expect(result.cycle).toBe("Cycle 1");
    expect(result.sprint).toBe("Sprint 3");
    expect(result.release).toBe("R2026.1");
    expect(result.environment).toBe("UAT");
    expect(result.priority).toBe("High");
    expect(result.severity).toBe("Major");
    expect(result.title).toBe("Login with valid credentials");
    expect(result.objective).toBe("Verify a registered user can sign in");
    expect(result.expectedResult).toBe("The dashboard is displayed");
  });

  it("passes the hierarchy ids through unchanged", () => {
    const result = buildTestCaseCreateData(validInput(), actor);

    expect(result.productId).toBe("product-1");
    expect(result.moduleId).toBe("module-1");
    expect(result.featureId).toBe("feature-1");
    expect(result.requirementId).toBe("requirement-1");
  });
});
