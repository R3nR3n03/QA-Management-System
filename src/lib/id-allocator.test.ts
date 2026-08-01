import { describe, expect, it } from "vitest";
import { AppError } from "./errors";
import { formatBusinessId, highestSuffix } from "./id-allocator";

/**
 * The pure halves of the allocator. The locked counter walk itself needs a real
 * PostgreSQL row lock and is exercised by the acceptance suite's generated-ID
 * scenarios (`docs/testing-and-acceptance.md` § Identity).
 */

describe("formatBusinessId", () => {
  it("zero-pads to the documented four digits", () => {
    expect(formatBusinessId("EXE-", 1)).toBe("EXE-0001");
    expect(formatBusinessId("BUG-", 42)).toBe("BUG-0042");
    expect(formatBusinessId("TC-PROD001-", 999)).toBe("TC-PROD001-0999");
    expect(formatBusinessId("EXE-", 9999)).toBe("EXE-9999");
  });

  it("refuses numbers outside the documented 0001-9999 space", () => {
    // docs/data-model.md — "allocation past 9999 is refused": a documented limit,
    // surfaced as an AppError, not silently widened to five digits.
    for (const n of [0, -1, 10000, 1.5]) {
      let thrown: unknown;
      try {
        formatBusinessId("EXE-", n);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(AppError);
      expect((thrown as AppError).status).toBe(422);
      expect((thrown as AppError).code).toBe("ID_INVALID");
    }
  });
});

describe("highestSuffix", () => {
  it("returns the max numeric suffix among ids with the exact prefix", () => {
    expect(highestSuffix("EXE-", ["EXE-0001", "EXE-0042", "EXE-0007"])).toBe(42);
  });

  it("returns 0 when nothing matches the prefix", () => {
    expect(highestSuffix("EXE-", [])).toBe(0);
    expect(highestSuffix("EXE-", ["BUG-0009"])).toBe(0);
  });

  it("sequences per prefix — another product's cases do not advance this one's seed", () => {
    // docs/data-model.md: generated test-case numbers are sequenced per product.
    const ids = ["TC-PROD001-0005", "TC-PROD002-0900", "TC-PROD001-0002"];
    expect(highestSuffix("TC-PROD001-", ids)).toBe(5);
    expect(highestSuffix("TC-PROD002-", ids)).toBe(900);
  });

  it("ignores non-numeric or differently shaped suffixes instead of tripping the seed", () => {
    expect(highestSuffix("EXE-", ["EXE-abcd", "EXE-00x1", "EXE-0003"])).toBe(3);
  });
});
