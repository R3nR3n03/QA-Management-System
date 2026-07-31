import { describe, expect, it } from "vitest";
import {
  createFeatureSchema,
  createModuleSchema,
  createProductSchema,
  createRequirementSchema,
  updateFeatureSchema,
  updateModuleSchema,
  updateProductSchema,
  updateRequirementSchema
} from "./catalogue";
import { schemaIssueField } from "./issues";

describe("createProductSchema", () => {
  const valid = { businessId: "PROD001", name: "CRM", versionTag: "1.0", status: "Active" };

  it("accepts a valid body and keeps exactly the declared keys", () => {
    const result = createProductSchema.safeParse(valid);

    expect(result.success).toBe(true);
    expect(Object.keys(result.data!).sort()).toEqual(["businessId", "name", "status", "versionTag"]);
  });

  it("rejects a smuggled server-controlled key", () => {
    for (const key of ["version", "createdBy", "id"]) {
      const result = createProductSchema.safeParse({ ...valid, [key]: "x" });

      expect(result.success).toBe(false);
      expect(schemaIssueField(result.error!.issues[0])).toBe(key);
    }
  });

  it("rejects a blank value on every field", () => {
    // Four requireNonBlank calls at catalogue.ts:20-23.
    for (const key of ["businessId", "name", "versionTag", "status"]) {
      expect(createProductSchema.safeParse({ ...valid, [key]: "" }).success).toBe(false);
    }
  });

  it("rejects a non-object body", () => {
    expect(createProductSchema.safeParse(null).success).toBe(false);
    expect(createProductSchema.safeParse([]).success).toBe(false);
  });
});

describe("updateProductSchema", () => {
  const valid = { version: 1, name: "CRM", versionTag: "1.1", status: "Active" };

  it("accepts a valid body and keeps exactly the declared keys", () => {
    const result = updateProductSchema.safeParse(valid);

    expect(result.success).toBe(true);
    expect(Object.keys(result.data!).sort()).toEqual(["name", "status", "version", "versionTag"]);
  });

  it("accepts an empty body — a missing version still yields 409 in the domain", () => {
    expect(updateProductSchema.safeParse({}).success).toBe(true);
  });

  it("rejects a blank value on every requireNonBlankIfProvided field", () => {
    // catalogue.ts:62-64.
    for (const key of ["name", "versionTag", "status"]) {
      expect(updateProductSchema.safeParse({ ...valid, [key]: "" }).success).toBe(false);
    }
  });

  it("rejects a smuggled businessId, which the update path must never change", () => {
    const result = updateProductSchema.safeParse({ ...valid, businessId: "PROD999" });

    expect(result.success).toBe(false);
    expect(schemaIssueField(result.error!.issues[0])).toBe("businessId");
  });
});

describe("createModuleSchema", () => {
  const valid = { businessId: "MOD001", name: "Billing", productId: "product-1" };

  it("accepts a valid body and keeps exactly the declared keys", () => {
    const result = createModuleSchema.safeParse(valid);

    expect(result.success).toBe(true);
    expect(Object.keys(result.data!).sort()).toEqual(["businessId", "name", "productId"]);
  });

  it("rejects a blank businessId and name", () => {
    // catalogue.ts:101-102.
    expect(createModuleSchema.safeParse({ ...valid, businessId: "" }).success).toBe(false);
    expect(createModuleSchema.safeParse({ ...valid, name: "" }).success).toBe(false);
  });

  it("permits a blank productId", () => {
    // createModule does not blank-guard productId; a blank id simply fails the findUnique at
    // catalogue.ts:105-106 and yields today's 404 REFERENCE_NOT_FOUND. Adding .min(1) here
    // would silently change that status code to a 422.
    expect(createModuleSchema.safeParse({ ...valid, productId: "" }).success).toBe(true);
  });

  it("rejects a smuggled createdBy", () => {
    expect(createModuleSchema.safeParse({ ...valid, createdBy: "someone" }).success).toBe(false);
  });
});

describe("updateModuleSchema", () => {
  it("accepts a valid body and keeps exactly the declared keys", () => {
    const result = updateModuleSchema.safeParse({ version: 2, name: "Billing v2" });

    expect(result.success).toBe(true);
    expect(Object.keys(result.data!).sort()).toEqual(["name", "version"]);
  });

  it("accepts an empty body and rejects a blank name", () => {
    expect(updateModuleSchema.safeParse({}).success).toBe(true);
    // requireNonBlankIfProvided at catalogue.ts:135.
    expect(updateModuleSchema.safeParse({ version: 2, name: "" }).success).toBe(false);
  });

  it("rejects a smuggled productId, which the update path must never reparent", () => {
    expect(updateModuleSchema.safeParse({ version: 2, productId: "other" }).success).toBe(false);
  });
});

describe("createFeatureSchema", () => {
  const valid = { businessId: "FEAT001", name: "Invoicing", moduleId: "module-1" };

  it("accepts a valid body and keeps exactly the declared keys", () => {
    const result = createFeatureSchema.safeParse(valid);

    expect(result.success).toBe(true);
    expect(Object.keys(result.data!).sort()).toEqual(["businessId", "moduleId", "name"]);
  });

  it("rejects a blank businessId and name", () => {
    // catalogue.ts:166-167.
    expect(createFeatureSchema.safeParse({ ...valid, businessId: "" }).success).toBe(false);
    expect(createFeatureSchema.safeParse({ ...valid, name: "" }).success).toBe(false);
  });

  it("permits a blank moduleId", () => {
    // No blank guard in createFeature; unresolved ids 404 at catalogue.ts:170-171.
    expect(createFeatureSchema.safeParse({ ...valid, moduleId: "" }).success).toBe(true);
  });
});

describe("updateFeatureSchema", () => {
  it("accepts a valid body and keeps exactly the declared keys", () => {
    const result = updateFeatureSchema.safeParse({ version: 5, name: "Invoicing v2" });

    expect(result.success).toBe(true);
    expect(Object.keys(result.data!).sort()).toEqual(["name", "version"]);
  });

  it("accepts an empty body and rejects a blank name", () => {
    expect(updateFeatureSchema.safeParse({}).success).toBe(true);
    // requireNonBlankIfProvided at catalogue.ts:200.
    expect(updateFeatureSchema.safeParse({ version: 5, name: "" }).success).toBe(false);
  });
});

describe("createRequirementSchema", () => {
  const valid = { businessId: "REQ001", statement: "The system shall issue invoices.", featureId: "feature-1" };

  it("accepts a valid body and keeps exactly the declared keys", () => {
    const result = createRequirementSchema.safeParse(valid);

    expect(result.success).toBe(true);
    expect(Object.keys(result.data!).sort()).toEqual(["businessId", "featureId", "statement"]);
  });

  it("rejects a blank businessId and statement", () => {
    // catalogue.ts:231-232.
    expect(createRequirementSchema.safeParse({ ...valid, businessId: "" }).success).toBe(false);
    expect(createRequirementSchema.safeParse({ ...valid, statement: "" }).success).toBe(false);
  });

  it("permits a blank featureId", () => {
    // No blank guard in createRequirement; unresolved ids 404 at catalogue.ts:235-236.
    expect(createRequirementSchema.safeParse({ ...valid, featureId: "" }).success).toBe(true);
  });
});

describe("updateRequirementSchema", () => {
  it("accepts a valid body and keeps exactly the declared keys", () => {
    const result = updateRequirementSchema.safeParse({ version: 9, statement: "Revised statement." });

    expect(result.success).toBe(true);
    expect(Object.keys(result.data!).sort()).toEqual(["statement", "version"]);
  });

  it("accepts an empty body and rejects a blank statement", () => {
    expect(updateRequirementSchema.safeParse({}).success).toBe(true);
    // requireNonBlankIfProvided at catalogue.ts:269.
    expect(updateRequirementSchema.safeParse({ version: 9, statement: "" }).success).toBe(false);
  });

  it("rejects a non-numeric version", () => {
    expect(updateRequirementSchema.safeParse({ version: "9" }).success).toBe(false);
  });
});
