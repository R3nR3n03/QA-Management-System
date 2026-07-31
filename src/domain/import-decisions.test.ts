import { describe, expect, it } from "vitest";
import { BUSINESS_ID_PATTERNS } from "@/lib/business-ids";
import { decideCatalogueRow, decideSettingsValue, type CatalogueRowInput } from "./import-decisions";

const product = (over: Partial<CatalogueRowInput> = {}): CatalogueRowInput => ({
  entityLabel: "Product",
  businessId: "PROD001",
  pattern: BUSINESS_ID_PATTERNS.product,
  patternLabel: "PROD###",
  alreadySeenInSheet: false,
  ...over
});

describe("decideCatalogueRow", () => {
  it("creates a well-formed row with no existing record", () => {
    expect(decideCatalogueRow(product())).toEqual({ kind: "CREATE" });
  });

  it("rejects a malformed business ID against the real pattern", () => {
    const decision = decideCatalogueRow(product({ businessId: "PRODUCT-1" }));
    expect(decision).toMatchObject({ kind: "REJECTED", errorCode: "ID_INVALID" });
    // The message must name the value and the documented format, or the import
    // report cannot be acted on without opening the code.
    expect(decision.kind === "REJECTED" && decision.details).toContain("PRODUCT-1");
    expect(decision.kind === "REJECTED" && decision.details).toContain("PROD###");
  });

  it("rejects a duplicate within the same sheet", () => {
    expect(decideCatalogueRow(product({ alreadySeenInSheet: true }))).toMatchObject({
      kind: "REJECTED",
      errorCode: "ID_DUPLICATE"
    });
  });

  // excel-source-map.md:34 - a row with an unknown parent is rejected without
  // partial dependent writes.
  it("rejects an unknown parent and names it", () => {
    const decision = decideCatalogueRow(
      product({
        entityLabel: "Module",
        businessId: "MOD001",
        pattern: BUSINESS_ID_PATTERNS.module,
        patternLabel: "MOD###",
        missingParent: { label: "Product", businessId: "PROD404" }
      })
    );
    expect(decision).toMatchObject({ kind: "REJECTED", errorCode: "REFERENCE_NOT_FOUND" });
    expect(decision.kind === "REJECTED" && decision.details).toContain("PROD404");
  });

  // business-rules-and-validation.md:45 - existing ID with identical normalized values.
  it("skips an existing record whose values are unchanged", () => {
    expect(decideCatalogueRow(product({ existing: { id: "p-1", unchanged: true } }))).toEqual({
      kind: "SKIPPED_UNCHANGED",
      recordId: "p-1"
    });
  });

  // business-rules-and-validation.md:45 - existing ID with different values "cannot
  // overwrite automatically". The caller must not write on this decision.
  it("requires reconciliation when an existing record differs, and never says overwrite", () => {
    const decision = decideCatalogueRow(product({ existing: { id: "p-1", unchanged: false } }));
    expect(decision).toMatchObject({ kind: "RECONCILIATION_REQUIRED", recordId: "p-1" });
    expect(decision.kind === "RECONCILIATION_REQUIRED" && decision.details).toContain(
      "automatic overwrite is not permitted"
    );
  });

  describe("precedence between checks", () => {
    // The order is the rule. These pin it so a refactor cannot quietly reorder the
    // checks and change which error a row reports.
    it("reports a malformed ID ahead of an in-sheet duplicate", () => {
      expect(
        decideCatalogueRow(product({ businessId: "nope", alreadySeenInSheet: true }))
      ).toMatchObject({ errorCode: "ID_INVALID" });
    });

    it("reports an in-sheet duplicate ahead of a missing parent", () => {
      expect(
        decideCatalogueRow(
          product({
            alreadySeenInSheet: true,
            missingParent: { label: "Product", businessId: "PROD404" }
          })
        )
      ).toMatchObject({ errorCode: "ID_DUPLICATE" });
    });

    it("reports a missing parent ahead of reconciliation", () => {
      expect(
        decideCatalogueRow(
          product({
            missingParent: { label: "Product", businessId: "PROD404" },
            existing: { id: "p-1", unchanged: false }
          })
        )
      ).toMatchObject({ errorCode: "REFERENCE_NOT_FOUND" });
    });

    it("never creates when a record already exists, whatever else is true", () => {
      for (const unchanged of [true, false]) {
        const decision = decideCatalogueRow(product({ existing: { id: "p-1", unchanged } }));
        expect(decision.kind).not.toBe("CREATE");
      }
    });
  });

  it("applies to every catalogue entity, not just products", () => {
    const cases = [
      { label: "Module", id: "MOD001", pattern: BUSINESS_ID_PATTERNS.module },
      { label: "Feature", id: "FEAT001", pattern: BUSINESS_ID_PATTERNS.feature },
      { label: "Requirement", id: "REQ001", pattern: BUSINESS_ID_PATTERNS.requirement }
    ];
    for (const c of cases) {
      expect(
        decideCatalogueRow(product({ entityLabel: c.label, businessId: c.id, pattern: c.pattern }))
      ).toEqual({ kind: "CREATE" });
      expect(
        decideCatalogueRow(product({ entityLabel: c.label, businessId: "PROD001", pattern: c.pattern }))
      ).toMatchObject({ kind: "REJECTED", errorCode: "ID_INVALID" });
    }
  });
});

describe("decideSettingsValue", () => {
  it("creates a value that does not exist", () => {
    expect(decideSettingsValue({ catalogue: "Priority", value: "High" })).toEqual({ kind: "CREATE" });
  });

  it("skips a value that is already configured and active", () => {
    expect(
      decideSettingsValue({
        catalogue: "Priority",
        value: "High",
        existing: { id: "cv-1", active: true }
      })
    ).toMatchObject({ kind: "SKIPPED_UNCHANGED", recordId: "cv-1" });
  });

  /**
   * The property that matters most here: re-importing the workbook must not
   * resurrect a value a QA Lead deactivated through PATCH /controlled-values.
   * prisma/seed.ts refuses the same reactivation for the same reason.
   */
  it("requires reconciliation rather than silently reactivating a deactivated value", () => {
    const decision = decideSettingsValue({
      catalogue: "Severity",
      value: "Minor",
      existing: { id: "cv-9", active: false }
    });
    expect(decision).toMatchObject({ kind: "RECONCILIATION_REQUIRED", recordId: "cv-9" });
    expect(decision.kind === "RECONCILIATION_REQUIRED" && decision.details).toContain("inactive");
    expect(decision.kind).not.toBe("CREATE");
  });

  it("skips a duplicate created earlier in the same run rather than creating it twice", () => {
    expect(
      decideSettingsValue({ catalogue: "Result", value: "Pass", createdEarlierInRun: "cv-new" })
    ).toMatchObject({ kind: "SKIPPED_UNCHANGED", recordId: "cv-new" });
  });

  it("prefers the persisted record over one created earlier in the run", () => {
    expect(
      decideSettingsValue({
        catalogue: "Result",
        value: "Pass",
        existing: { id: "cv-persisted", active: true },
        createdEarlierInRun: "cv-new"
      })
    ).toMatchObject({ recordId: "cv-persisted" });
  });
});
