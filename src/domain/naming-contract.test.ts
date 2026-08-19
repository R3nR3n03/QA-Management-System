import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { TEST_CASE_ID_IN_TEXT } from "@/lib/business-ids";
import {
  buildNamingContract,
  NAMING_CONTRACT_FILENAME,
  type ContractCase
} from "./naming-contract";

const AT = new Date("2026-08-18T06:32:45.000Z");

const one = (over: Partial<ContractCase> & { businessId: string }): ContractCase => ({
  title: "Payment succeeds with a valid card",
  featureBusinessId: "FEAT001",
  featureName: "Card payment",
  moduleName: "Checkout",
  ...over
});

describe("naming contract", () => {
  it("has a stable download name", () => {
    expect(NAMING_CONTRACT_FILENAME).toBe("qams-naming-contract.md");
  });

  it("refuses an empty selection rather than emitting an empty document", () => {
    // A contract naming nothing reads as one someone forgot to fill in, and would be
    // passed on as though it said something.
    expect(() => buildNamingContract([], AT)).toThrow(AppError);
    expect(() => buildNamingContract([], AT)).toThrow(/at least one test case/i);
  });

  it("states the instant in UTC, not a local rendering", () => {
    const text = buildNamingContract([one({ businessId: "TC-PROD001-0001" })], AT);
    // The document leaves QAMS; a reader elsewhere cannot ask what zone it meant.
    expect(text).toContain("2026-08-18 06:32 UTC");
  });

  it("counts the cases it lists", () => {
    const text = buildNamingContract(
      [one({ businessId: "TC-PROD001-0001" }), one({ businessId: "TC-PROD001-0002" })],
      AT
    );
    expect(text).toContain("· 2 test cases");
    expect(buildNamingContract([one({ businessId: "TC-PROD001-0001" })], AT)).toContain(
      "· 1 test case"
    );
  });

  it("groups by feature, in business-ID order, cases ordered within", () => {
    const text = buildNamingContract(
      [
        one({ businessId: "TC-PROD001-0009", featureBusinessId: "FEAT002", featureName: "Refunds" }),
        one({ businessId: "TC-PROD001-0002" }),
        one({ businessId: "TC-PROD001-0001" })
      ],
      AT
    );

    const headings = text.match(/^## .+$/gm) ?? [];
    expect(headings).toEqual([
      "## Checkout · Card payment (FEAT001)",
      "## Checkout · Refunds (FEAT002)"
    ]);

    const ids = (text.match(/TC-[A-Za-z0-9]+-\d{4}/g) ?? []);
    expect(ids).toEqual(["TC-PROD001-0001", "TC-PROD001-0002", "TC-PROD001-0009"]);
  });

  it("writes each case as an ID the ingestion pattern would find, plus its title", () => {
    const text = buildNamingContract(
      [one({ businessId: "TC-PROD001-0001", title: "Payment succeeds with a valid card" })],
      AT
    );

    expect(text).toContain("- `TC-PROD001-0001` — Payment succeeds with a valid card");
    // The whole point of the document: what it names is what a spec name must contain for
    // ingestion to resolve it (`TEST_CASE_ID_IN_TEXT`).
    expect(TEST_CASE_ID_IN_TEXT.test("TC-PROD001-0001")).toBe(true);
  });

  it("says the rule and points at the sample for the shape", () => {
    const text = buildNamingContract([one({ businessId: "TC-PROD001-0001" })], AT);
    expect(text).toMatch(/naming its business ID/);
    expect(text).toMatch(/describe block/);
    expect(text).toMatch(/sample results file/);
    // Says why a case someone expected is missing, rather than leaving them to guess.
    expect(text).toMatch(/Approved cases only/);
  });

  it("is a function of its arguments alone", () => {
    const cases = [one({ businessId: "TC-PROD001-0001" })];
    expect(buildNamingContract(cases, AT)).toBe(buildNamingContract(cases, AT));
  });
});
