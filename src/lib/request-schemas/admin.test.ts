import { QamsRole } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { updateControlledValueSchema, updateUserRoleSchema } from "./admin";
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
