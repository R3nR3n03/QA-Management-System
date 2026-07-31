import { describe, expect, it } from "vitest";
import { loginSchema } from "./auth";
import { schemaIssueField } from "./issues";

describe("loginSchema", () => {
  const valid = { email: "tester@example.com", password: "correct horse" };

  it("accepts a valid body and keeps exactly the declared keys", () => {
    const result = loginSchema.safeParse(valid);

    expect(result.success).toBe(true);
    expect(Object.keys(result.data!).sort()).toEqual(["email", "password"]);
  });

  it("rejects an omitted email or password", () => {
    expect(loginSchema.safeParse({ password: "x" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: "tester@example.com" }).success).toBe(false);
  });

  it("permits a blank and whitespace-only email and a blank password", () => {
    // Deliberately additive: the route's own guard at auth/login/route.ts:12 rejects both,
    // with the 422 message clients already receive. A `.min(1)` here would not subsume that
    // guard anyway, since it still admits " ".
    expect(loginSchema.safeParse({ ...valid, email: "" }).success).toBe(true);
    expect(loginSchema.safeParse({ ...valid, email: "   " }).success).toBe(true);
    expect(loginSchema.safeParse({ ...valid, password: "" }).success).toBe(true);
  });

  it("does not validate the email format", () => {
    // No document in the knowledge base establishes an email-format rule for login, and the
    // lookup is an exact match that simply fails. `.email()` here would invent policy.
    expect(loginSchema.safeParse({ ...valid, email: "not-an-email" }).success).toBe(true);
  });

  it("rejects a smuggled role or active flag on the one unauthenticated route", () => {
    for (const key of ["role", "active", "userId"]) {
      const result = loginSchema.safeParse({ ...valid, [key]: "QA_LEAD" });

      expect(result.success).toBe(false);
      expect(schemaIssueField(result.error!.issues[0])).toBe(key);
    }
  });

  it("rejects a non-object body", () => {
    // Audit §3.7: `parseJson` returned a literal `null` unchanged and the next line
    // dereferenced it, producing a 500 on the login endpoint.
    expect(loginSchema.safeParse(null).success).toBe(false);
    expect(loginSchema.safeParse([]).success).toBe(false);
    expect(loginSchema.safeParse(3).success).toBe(false);
  });
});
