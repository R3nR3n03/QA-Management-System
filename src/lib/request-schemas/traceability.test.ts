import { describe, expect, it } from "vitest";
import { schemaIssueField } from "./issues";
import { createRtmLinkSchema } from "./traceability";

describe("createRtmLinkSchema", () => {
  const valid = { requirementId: "requirement-1", testCaseId: "test-case-1" };

  it("accepts a minimal body and keeps exactly the declared keys", () => {
    const result = createRtmLinkSchema.safeParse(valid);

    expect(result.success).toBe(true);
    expect(Object.keys(result.data!).sort()).toEqual(["requirementId", "testCaseId"]);
  });

  it("accepts an optional defectId", () => {
    const result = createRtmLinkSchema.safeParse({ ...valid, defectId: "defect-1" });

    expect(result.success).toBe(true);
    expect(Object.keys(result.data!).sort()).toEqual(["defectId", "requirementId", "testCaseId"]);
  });

  it("rejects an omitted requirementId or testCaseId", () => {
    expect(createRtmLinkSchema.safeParse({ testCaseId: "test-case-1" }).success).toBe(false);
    expect(createRtmLinkSchema.safeParse({ requirementId: "requirement-1" }).success).toBe(false);
  });

  it("permits a blank requirementId, testCaseId and defectId", () => {
    // createRtmLink blank-guards none of the three: unresolved requirement/test case 404 at
    // traceability.ts:30-32 and a mismatched defect 422s at :48-53. Adding .min(1) would move
    // those rejections to a different status code.
    expect(createRtmLinkSchema.safeParse({ ...valid, requirementId: "" }).success).toBe(true);
    expect(createRtmLinkSchema.safeParse({ ...valid, testCaseId: "" }).success).toBe(true);
    expect(createRtmLinkSchema.safeParse({ ...valid, defectId: "" }).success).toBe(true);
  });

  it("rejects a smuggled actorRole, actorId or requestId", () => {
    // The route used to spread the body into the domain input alongside these three, so a
    // body could have overwritten the authenticated actor's role. It now passes explicit
    // fields; this is the second, independent guard.
    for (const key of ["actorRole", "actorId", "requestId", "createdBy"]) {
      const result = createRtmLinkSchema.safeParse({ ...valid, [key]: "QA_LEAD" });

      expect(result.success).toBe(false);
      expect(schemaIssueField(result.error!.issues[0])).toBe(key);
    }
  });

  it("rejects a non-object body", () => {
    expect(createRtmLinkSchema.safeParse(null).success).toBe(false);
    expect(createRtmLinkSchema.safeParse([]).success).toBe(false);
  });
});
