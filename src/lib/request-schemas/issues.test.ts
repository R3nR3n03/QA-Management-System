import { describe, expect, it } from "vitest";
import { schemaValidationError } from "./issues";
import { createTestCaseSchema } from "./test-cases";

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
