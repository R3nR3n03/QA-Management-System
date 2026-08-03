import { describe, expect, it } from "vitest";
import { schemaIssueField } from "./issues";
import {
  approveTestCaseSchema,
  createTestCaseSchema,
  replaceStepsSchema,
  retireTestCaseSchema,
  returnTestCaseToDraftSchema,
  submitTestCaseSchema,
  updateTestCaseDraftSchema
} from "./test-cases";

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

  it("permits an omitted businessId — the server allocates one", () => {
    // docs/api-and-security.md:5 — optional, not forbidden: the acceptance suite's
    // literal-ID posts stay valid, ID-less creates get the next generated ID.
    const { businessId: _businessId, ...withoutId } = validBody;

    expect(createTestCaseSchema.safeParse(withoutId).success).toBe(true);
  });

  it("rejects a blank businessId but permits a blank cycle", () => {
    // Optional is not blank-tolerant: a supplied ID must still carry a value.
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

  it("permits every field createTestCase tolerates blank on create", () => {
    // test-cases.ts:109-110 only consults the controlled-value catalogue when the value is
    // non-blank, and buildTestCaseCreateData writes the trimmed value through unconditionally.
    // submitTestCase (test-cases.ts:277-282) is where non-blank becomes mandatory.
    for (const key of ["cycle", "sprint", "release", "environment", "priority", "severity"]) {
      expect(createTestCaseSchema.safeParse({ ...validBody, [key]: "" }).success).toBe(true);
    }
  });
});

describe("updateTestCaseDraftSchema", () => {
  const fullBody = {
    version: 3,
    cycle: "Cycle 2",
    sprint: "Sprint 4",
    release: "R2026.2",
    environment: "SIT",
    title: "Updated title",
    objective: "Updated objective",
    expectedResult: "Updated expected result",
    priority: "Medium",
    severity: "Minor"
  };

  it("accepts a complete body and keeps exactly the declared keys", () => {
    const result = updateTestCaseDraftSchema.safeParse(fullBody);

    expect(result.success).toBe(true);
    expect(Object.keys(result.data!).sort()).toEqual([
      "cycle",
      "environment",
      "expectedResult",
      "objective",
      "priority",
      "release",
      "severity",
      "sprint",
      "title",
      "version"
    ]);
  });

  it("accepts an empty body — every field is optional, including version", () => {
    // A missing version deliberately still reaches ensureVersion and yields 409
    // VERSION_CONFLICT (test-cases.ts:180), the mapping docs/business-rules-and-validation.md:15
    // establishes. Requiring it here would change that documented rule into a 422.
    expect(updateTestCaseDraftSchema.safeParse({}).success).toBe(true);
  });

  it("rejects an injected lifecycleState", () => {
    const result = updateTestCaseDraftSchema.safeParse({ ...fullBody, lifecycleState: "APPROVED" });

    expect(result.success).toBe(false);
    expect(schemaIssueField(result.error!.issues[0])).toBe("lifecycleState");
  });

  it("rejects a blank value on every requireNonBlankIfProvided field", () => {
    for (const key of ["cycle", "sprint", "release", "environment", "title", "objective", "expectedResult"]) {
      expect(updateTestCaseDraftSchema.safeParse({ ...fullBody, [key]: "" }).success).toBe(false);
    }
  });

  it("permits a blank priority and severity", () => {
    // test-cases.ts:193-194 writes `input.priority?.trim() ?? current.priority`, so "" clears
    // the stored value, and :182-183 skips the catalogue check when blank. Rejecting "" here
    // would remove a capability that exists today.
    expect(updateTestCaseDraftSchema.safeParse({ ...fullBody, priority: "" }).success).toBe(true);
    expect(updateTestCaseDraftSchema.safeParse({ ...fullBody, severity: "" }).success).toBe(true);
  });

  it("rejects a non-numeric version", () => {
    expect(updateTestCaseDraftSchema.safeParse({ ...fullBody, version: "3" }).success).toBe(false);
  });
});

describe("replaceStepsSchema", () => {
  const fullBody = {
    version: 1,
    steps: [
      { sequence: 1, action: "Open the login page", expectedResult: "The form is displayed" },
      { sequence: 2, action: "Submit valid credentials", expectedResult: "The dashboard opens" }
    ]
  };

  it("accepts a complete body and keeps exactly the declared keys", () => {
    const result = replaceStepsSchema.safeParse(fullBody);

    expect(result.success).toBe(true);
    expect(Object.keys(result.data!).sort()).toEqual(["steps", "version"]);
    expect(Object.keys(result.data!.steps[0]).sort()).toEqual(["action", "expectedResult", "sequence"]);
  });

  it("rejects an omitted steps array", () => {
    // Today this reaches ensureStepSequence as undefined and throws a TypeError (500).
    const result = replaceStepsSchema.safeParse({ version: 1 });

    expect(result.success).toBe(false);
    expect(schemaIssueField(result.error!.issues[0])).toBe("steps");
  });

  it("permits an empty steps array", () => {
    // An empty array wipes all steps today, and docs/business-rules-and-validation.md:19
    // requires at least one step *before review* — submitTestCase enforces that count at
    // test-cases.ts:275. Adding .min(1) here would move that gate earlier and invent policy.
    expect(replaceStepsSchema.safeParse({ version: 1, steps: [] }).success).toBe(true);
  });

  it("rejects a blank step action or expected result and names the path", () => {
    const blankAction = replaceStepsSchema.safeParse({
      version: 1,
      steps: [{ sequence: 1, action: "", expectedResult: "ok" }]
    });

    expect(blankAction.success).toBe(false);
    expect(schemaIssueField(blankAction.error!.issues[0])).toBe("steps.0.action");

    const blankExpected = replaceStepsSchema.safeParse({
      version: 1,
      steps: [{ sequence: 1, action: "ok", expectedResult: "" }]
    });

    expect(blankExpected.success).toBe(false);
    expect(schemaIssueField(blankExpected.error!.issues[0])).toBe("steps.0.expectedResult");
  });

  it("rejects an unrecognized key inside a step", () => {
    const result = replaceStepsSchema.safeParse({
      version: 1,
      steps: [{ sequence: 1, action: "ok", expectedResult: "ok", testCaseId: "other-case" }]
    });

    expect(result.success).toBe(false);
    expect(result.error!.issues[0].code).toBe("unrecognized_keys");
  });

  it("permits a non-integer sequence", () => {
    // ensureStepSequence (validation.ts:19-26) is the sole authority on sequence values and
    // rejects anything that is not consecutive 1..n. Adding .int() here would duplicate and
    // pre-empt that rule with a different error field.
    expect(replaceStepsSchema.safeParse({ version: 1, steps: [{ sequence: 1.5, action: "a", expectedResult: "b" }] }).success).toBe(true);
  });
});

describe("the version-only lifecycle schemas", () => {
  it("submitTestCaseSchema accepts a version and nothing else", () => {
    const result = submitTestCaseSchema.safeParse({ version: 2 });

    expect(result.success).toBe(true);
    expect(Object.keys(result.data!).sort()).toEqual(["version"]);
    expect(submitTestCaseSchema.safeParse({}).success).toBe(true);
    expect(submitTestCaseSchema.safeParse({ version: 2, lifecycleState: "APPROVED" }).success).toBe(false);
  });

  it("approveTestCaseSchema accepts a version and nothing else", () => {
    const result = approveTestCaseSchema.safeParse({ version: 2 });

    expect(result.success).toBe(true);
    expect(Object.keys(result.data!).sort()).toEqual(["version"]);
    expect(approveTestCaseSchema.safeParse({}).success).toBe(true);
    expect(approveTestCaseSchema.safeParse({ version: 2, authorUserId: "someone" }).success).toBe(false);
  });
});

describe("returnTestCaseToDraftSchema", () => {
  it("accepts a version and a reviewReason", () => {
    const result = returnTestCaseToDraftSchema.safeParse({ version: 4, reviewReason: "Steps are ambiguous" });

    expect(result.success).toBe(true);
    expect(Object.keys(result.data!).sort()).toEqual(["reviewReason", "version"]);
  });

  it("rejects a blank or missing reviewReason", () => {
    // requireNonBlank at test-cases.ts:346 — this is not new policy, only an earlier failure.
    expect(returnTestCaseToDraftSchema.safeParse({ version: 4, reviewReason: "" }).success).toBe(false);
    expect(returnTestCaseToDraftSchema.safeParse({ version: 4 }).success).toBe(false);
  });

  it("rejects a smuggled lifecycleState", () => {
    const result = returnTestCaseToDraftSchema.safeParse({
      version: 4,
      reviewReason: "Needs work",
      lifecycleState: "RETIRED"
    });

    expect(result.success).toBe(false);
    expect(schemaIssueField(result.error!.issues[0])).toBe("lifecycleState");
  });
});

describe("retireTestCaseSchema", () => {
  it("accepts a version and a retirementReason", () => {
    const result = retireTestCaseSchema.safeParse({ version: 7, retirementReason: "Feature withdrawn" });

    expect(result.success).toBe(true);
    expect(Object.keys(result.data!).sort()).toEqual(["retirementReason", "version"]);
  });

  it("rejects a blank or missing retirementReason", () => {
    // requireNonBlank at test-cases.ts:382.
    expect(retireTestCaseSchema.safeParse({ version: 7, retirementReason: "" }).success).toBe(false);
    expect(retireTestCaseSchema.safeParse({ version: 7 }).success).toBe(false);
  });
});
