import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { USER_RESPONSE_SELECT } from "./admin";

/**
 * Guards the fix for IMPLEMENTATION-AUDIT-2026-07-31.md §2.2 — `PATCH /users/{id}/role`
 * returned the whole Prisma User record, `passwordHash` included, against
 * `docs/data-model.md:35`: "passwordHash is never returned by the API or written to
 * audit logs."
 *
 * These compare the projection against Prisma's own generated field list rather than
 * a hand-copied one, so the assertions stay true as the model changes instead of
 * quietly testing a stale idea of what a User is.
 */
const MODEL_FIELDS = Object.keys(Prisma.UserScalarFieldEnum);
const SELECTED = Object.keys(USER_RESPONSE_SELECT);

describe("USER_RESPONSE_SELECT", () => {
  it("does not select passwordHash", () => {
    expect(SELECTED).not.toContain("passwordHash");
  });

  /**
   * Without this, the test above passes trivially if the field is ever renamed —
   * "we don't select `passwordHash`" is worthless if no such field exists. This
   * pins that the exclusion is still excluding something real.
   */
  it("excludes a field the model actually has", () => {
    expect(MODEL_FIELDS).toContain("passwordHash");
  });

  it("selects only real User fields, so no key is a silent typo", () => {
    for (const key of SELECTED) {
      expect(MODEL_FIELDS).toContain(key);
    }
  });

  /**
   * The load-bearing one. A `select` is an allow-list: a field added to the User
   * model in future is excluded by default rather than leaking by default. If someone
   * widens this projection, they have to change this list deliberately.
   */
  it("is the exact intended allow-list", () => {
    expect(SELECTED.sort()).toEqual(
      ["id", "email", "displayName", "role", "active", "version"].sort()
    );
  });

  // api-and-security.md:5 - a mutation returns the updated record with its new version.
  it("includes version, which the mutation contract requires", () => {
    expect(SELECTED).toContain("version");
  });

  // api-and-security.md:33 - do not expose internal identifiers beyond the requested
  // record. createdBy/updatedBy are the ids of OTHER users.
  it("omits the internal actor identifiers and timestamps", () => {
    for (const key of ["createdBy", "updatedBy", "createdAt", "updatedAt"]) {
      expect(SELECTED).not.toContain(key);
    }
  });

  it("sets every selected field to true, with no nested or disabled entry", () => {
    for (const value of Object.values(USER_RESPONSE_SELECT)) {
      expect(value).toBe(true);
    }
  });
});
