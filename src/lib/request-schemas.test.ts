import { describe, expect, it } from "vitest";
import { createTestCaseSchema, schemaIssueField, schemaValidationError } from "./request-schemas";

const validBody = {
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
  expectedResult: "The dashboard is displayed"
};

describe("createTestCaseSchema", () => {
  it("accepts a complete valid body", () => {
    const result = createTestCaseSchema.safeParse(validBody);

    expect(result.success).toBe(true);
  });

  it("accepts a body carrying revisesTestCaseId", () => {
    const result = createTestCaseSchema.safeParse({ ...validBody, revisesTestCaseId: "prior-case-id" });

    expect(result.success).toBe(true);
  });

  it("rejects an injected lifecycleState as an unrecognized key", () => {
    // The boundary half of the mass-assignment fix: without strictObject this key would be
    // silently dropped instead of reported, and the caller would never learn it was ignored.
    const result = createTestCaseSchema.safeParse({ ...validBody, lifecycleState: "APPROVED" });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].code).toBe("unrecognized_keys");
    expect(schemaIssueField(result.error!.issues[0])).toBe("lifecycleState");
  });

  it("rejects the other injectable server-controlled fields", () => {
    for (const key of ["version", "reviewReason", "retirementReason", "authorUserId", "createdBy", "id"]) {
      const result = createTestCaseSchema.safeParse({ ...validBody, [key]: "x" });

      expect(result.success).toBe(false);
      expect(schemaIssueField(result.error!.issues[0])).toBe(key);
    }
  });

  it("rejects a missing required field and names it", () => {
    const { title: _title, ...withoutTitle } = validBody;
    const result = createTestCaseSchema.safeParse(withoutTitle);

    expect(result.success).toBe(false);
    expect(schemaIssueField(result.error!.issues[0])).toBe("title");
  });

  it("rejects a blank businessId but permits a blank cycle", () => {
    expect(createTestCaseSchema.safeParse({ ...validBody, businessId: "" }).success).toBe(false);
    // createTestCase deliberately permits these blank on create; submitTestCase enforces
    // non-blank before review, so tightening them here would invent policy.
    expect(createTestCaseSchema.safeParse({ ...validBody, cycle: "" }).success).toBe(true);
    expect(createTestCaseSchema.safeParse({ ...validBody, priority: "" }).success).toBe(true);
  });

  it("rejects a non-object body", () => {
    expect(createTestCaseSchema.safeParse(null).success).toBe(false);
    expect(createTestCaseSchema.safeParse([]).success).toBe(false);
  });

  it("rejects a wrongly typed field", () => {
    const result = createTestCaseSchema.safeParse({ ...validBody, title: 42 });

    expect(result.success).toBe(false);
    expect(schemaIssueField(result.error!.issues[0])).toBe("title");
  });
});

describe("schemaValidationError", () => {
  it("maps an injected lifecycleState to 422 / ID_INVALID / field lifecycleState", () => {
    const result = createTestCaseSchema.safeParse({ ...validBody, lifecycleState: "APPROVED" });
    const error = schemaValidationError(result.error!);

    // unrecognized_keys carries an empty path, so the field must come from issue.keys[0].
    expect(error.status).toBe(422);
    expect(error.code).toBe("ID_INVALID");
    expect(error.field).toBe("lifecycleState");
  });

  it("maps a missing field to 422 / ID_INVALID with the field path", () => {
    const { objective: _objective, ...withoutObjective } = validBody;
    const error = schemaValidationError(createTestCaseSchema.safeParse(withoutObjective).error!);

    expect(error.status).toBe(422);
    expect(error.code).toBe("ID_INVALID");
    expect(error.field).toBe("objective");
  });

  it("leaves field undefined when the issue has neither a path nor keys", () => {
    const error = schemaValidationError(createTestCaseSchema.safeParse(null).error!);

    expect(error.status).toBe(422);
    expect(error.code).toBe("ID_INVALID");
    expect(error.field).toBeUndefined();
  });
});
