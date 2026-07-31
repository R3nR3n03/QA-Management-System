import { QamsRole } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  createControlledValueSchema,
  patchUserSchema,
  setUserActiveSchema,
  updateControlledValueSchema,
  updateUserProfileSchema,
  updateUserRoleSchema
} from "./admin";
import { schemaIssueField } from "./issues";

describe("updateControlledValueSchema", () => {
  const valid = { id: "cv-1", active: false, version: 1 };

  it("accepts a valid body and keeps exactly the declared keys", () => {
    const result = updateControlledValueSchema.safeParse(valid);

    expect(result.success).toBe(true);
    expect(Object.keys(result.data!).sort()).toEqual(["active", "id", "version"]);
  });

  it("rejects a non-boolean active", () => {
    // admin.ts:26 writes `active` straight to a boolean column, so a string reaches Prisma
    // today and fails there as a 500.
    for (const value of ["false", 0, null, "yes"]) {
      const result = updateControlledValueSchema.safeParse({ ...valid, active: value });

      expect(result.success).toBe(false);
      expect(schemaIssueField(result.error!.issues[0])).toBe("active");
    }
  });

  it("rejects an omitted active or id", () => {
    expect(updateControlledValueSchema.safeParse({ id: "cv-1", version: 1 }).success).toBe(false);
    expect(updateControlledValueSchema.safeParse({ active: true, version: 1 }).success).toBe(false);
  });

  it("permits a blank id", () => {
    // The only write route taking its target id from the body. updateControlledValue does not
    // blank-guard it; an unresolved id 404s at admin.ts:17-18.
    expect(updateControlledValueSchema.safeParse({ ...valid, id: "" }).success).toBe(true);
  });

  it("accepts an omitted version — a missing version still yields 409 in the domain", () => {
    expect(updateControlledValueSchema.safeParse({ id: "cv-1", active: true }).success).toBe(true);
  });

  it("rejects a smuggled actorId, requestId, catalogue or value", () => {
    // actorId and requestId are server-supplied from the authenticated session; catalogue and
    // value are not editable through this route at all.
    for (const key of ["actorId", "requestId", "catalogue", "value"]) {
      const result = updateControlledValueSchema.safeParse({ ...valid, [key]: "x" });

      expect(result.success).toBe(false);
      expect(schemaIssueField(result.error!.issues[0])).toBe(key);
    }
  });

  it("rejects a non-object body", () => {
    expect(updateControlledValueSchema.safeParse(null).success).toBe(false);
    expect(updateControlledValueSchema.safeParse([]).success).toBe(false);
  });
});

describe("updateUserRoleSchema", () => {
  const valid = { role: QamsRole.QA_LEAD, version: 4 };

  it("accepts a valid body and keeps exactly the declared keys", () => {
    const result = updateUserRoleSchema.safeParse(valid);

    expect(result.success).toBe(true);
    expect(Object.keys(result.data!).sort()).toEqual(["role", "version"]);
  });

  it("accepts every real QamsRole", () => {
    for (const role of Object.values(QamsRole)) {
      expect(updateUserRoleSchema.safeParse({ role, version: 1 }).success).toBe(true);
    }
  });

  it("rejects a bogus or omitted role", () => {
    // Today an arbitrary string reaches the Prisma enum column and fails there as a 500.
    const bogus = updateUserRoleSchema.safeParse({ role: "ADMIN", version: 1 });

    expect(bogus.success).toBe(false);
    expect(schemaIssueField(bogus.error!.issues[0])).toBe("role");

    const omitted = updateUserRoleSchema.safeParse({ version: 1 });

    expect(omitted.success).toBe(false);
    expect(schemaIssueField(omitted.error!.issues[0])).toBe("role");
  });

  it("accepts an omitted version — a missing version still yields 409 in the domain", () => {
    expect(updateUserRoleSchema.safeParse({ role: QamsRole.QA_TESTER }).success).toBe(true);
  });

  it("rejects a smuggled actorId, requestId, active or passwordHash", () => {
    for (const key of ["actorId", "requestId", "active", "passwordHash", "email"]) {
      const result = updateUserRoleSchema.safeParse({ ...valid, [key]: "x" });

      expect(result.success).toBe(false);
      expect(schemaIssueField(result.error!.issues[0])).toBe(key);
    }
  });
});

describe("updateUserProfileSchema", () => {
  it("accepts displayName alone, email alone, or both", () => {
    expect(updateUserProfileSchema.safeParse({ displayName: "New Name", version: 1 }).success).toBe(true);
    expect(updateUserProfileSchema.safeParse({ email: "new@example.com", version: 1 }).success).toBe(true);
    expect(
      updateUserProfileSchema.safeParse({ displayName: "New Name", email: "new@example.com", version: 1 }).success
    ).toBe(true);
  });

  it("rejects a body with neither profile field — an empty patch is a caller mistake", () => {
    expect(updateUserProfileSchema.safeParse({ version: 1 }).success).toBe(false);
    expect(updateUserProfileSchema.safeParse({}).success).toBe(false);
  });

  it("accepts an omitted version — a missing version still yields 409 in the domain", () => {
    expect(updateUserProfileSchema.safeParse({ displayName: "New Name" }).success).toBe(true);
  });

  it("permits a blank displayName or email — blankness is the domain's 422", () => {
    // requireNonBlankIfProvided in updateUserProfile; tightening here would change the field
    // reported for the mixed case (blank name + valid email).
    expect(updateUserProfileSchema.safeParse({ displayName: "", email: "a@b.c", version: 1 }).success).toBe(true);
  });

  it("rejects a smuggled role, active, passwordHash, actorId or requestId", () => {
    for (const key of ["role", "active", "passwordHash", "actorId", "requestId"]) {
      const result = updateUserProfileSchema.safeParse({ displayName: "New Name", version: 1, [key]: "x" });

      expect(result.success).toBe(false);
    }
  });

  it("rejects a non-object body", () => {
    expect(updateUserProfileSchema.safeParse(null).success).toBe(false);
    expect(updateUserProfileSchema.safeParse([]).success).toBe(false);
  });
});

describe("setUserActiveSchema", () => {
  const valid = { active: false, version: 3 };

  it("accepts a valid body and keeps exactly the declared keys", () => {
    const result = setUserActiveSchema.safeParse(valid);

    expect(result.success).toBe(true);
    expect(Object.keys(result.data!).sort()).toEqual(["active", "version"]);
  });

  it("rejects a non-boolean or omitted active", () => {
    // setUserActive writes `active` straight to a boolean column.
    for (const value of ["false", 0, null, "yes"]) {
      const result = setUserActiveSchema.safeParse({ ...valid, active: value });

      expect(result.success).toBe(false);
      expect(schemaIssueField(result.error!.issues[0])).toBe("active");
    }
    expect(setUserActiveSchema.safeParse({ version: 3 }).success).toBe(false);
  });

  it("accepts an omitted version — a missing version still yields 409 in the domain", () => {
    expect(setUserActiveSchema.safeParse({ active: true }).success).toBe(true);
  });

  it("rejects a smuggled displayName, email, role or sessionsValidFrom", () => {
    for (const key of ["displayName", "email", "role", "sessionsValidFrom"]) {
      const result = setUserActiveSchema.safeParse({ ...valid, [key]: "x" });

      expect(result.success).toBe(false);
      expect(schemaIssueField(result.error!.issues[0])).toBe(key);
    }
  });
});

describe("patchUserSchema", () => {
  it("matches exactly one branch: activation or profile", () => {
    const activation = patchUserSchema.safeParse({ active: false, version: 1 });
    expect(activation.success).toBe(true);
    expect("active" in activation.data!).toBe(true);

    const profile = patchUserSchema.safeParse({ displayName: "New Name", version: 1 });
    expect(profile.success).toBe(true);
    expect("active" in profile.data!).toBe(false);
  });

  it("rejects a body mixing activation and profile fields — one domain call per request", () => {
    // Both branches are strict, so the mixed body matches neither and 422s at the boundary.
    expect(patchUserSchema.safeParse({ active: false, displayName: "New Name", version: 1 }).success).toBe(false);
    expect(patchUserSchema.safeParse({ active: false, email: "a@b.c", version: 1 }).success).toBe(false);
  });

  it("rejects an empty body", () => {
    expect(patchUserSchema.safeParse({}).success).toBe(false);
    expect(patchUserSchema.safeParse({ version: 1 }).success).toBe(false);
  });
});

describe("createControlledValueSchema", () => {
  const valid = { catalogue: "Priority", value: "Urgent" };

  it("accepts a valid body and keeps exactly the declared keys", () => {
    const result = createControlledValueSchema.safeParse(valid);

    expect(result.success).toBe(true);
    expect(Object.keys(result.data!).sort()).toEqual(["catalogue", "value"]);
  });

  it("accepts exactly the three documented catalogues", () => {
    for (const catalogue of ["Priority", "Severity", "Result"]) {
      expect(createControlledValueSchema.safeParse({ ...valid, catalogue }).success).toBe(true);
    }
  });

  it("rejects an unknown or omitted catalogue — a new catalogue is a policy change, not input", () => {
    const bogus = createControlledValueSchema.safeParse({ ...valid, catalogue: "Environment" });

    expect(bogus.success).toBe(false);
    expect(schemaIssueField(bogus.error!.issues[0])).toBe("catalogue");

    // Catalogue names are matched case-sensitively (`controlled-value-catalogues.ts`).
    expect(createControlledValueSchema.safeParse({ ...valid, catalogue: "priority" }).success).toBe(false);
    expect(createControlledValueSchema.safeParse({ value: "Urgent" }).success).toBe(false);
  });

  it("rejects a blank or omitted value", () => {
    // requireNonBlank in createControlledValue; `.min(1)` mirrors it at the boundary.
    expect(createControlledValueSchema.safeParse({ ...valid, value: "" }).success).toBe(false);
    expect(createControlledValueSchema.safeParse({ catalogue: "Priority" }).success).toBe(false);
  });

  it("rejects a smuggled active, id, actorId or requestId", () => {
    for (const key of ["active", "id", "actorId", "requestId"]) {
      const result = createControlledValueSchema.safeParse({ ...valid, [key]: "x" });

      expect(result.success).toBe(false);
      expect(schemaIssueField(result.error!.issues[0])).toBe(key);
    }
  });

  it("rejects a non-object body", () => {
    expect(createControlledValueSchema.safeParse(null).success).toBe(false);
    expect(createControlledValueSchema.safeParse([]).success).toBe(false);
  });
});
