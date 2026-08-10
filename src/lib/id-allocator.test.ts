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

  /**
   * The catalogue's four levels are `PROD###`, `MOD###`, `FEAT###` and `REQ###` — THREE
   * digits (`docs/data-model.md` § Core catalogue). A four-digit allocator emits `REQ0001`,
   * which fails `BUSINESS_ID_PATTERNS.requirement`, which is why those four services were
   * never wired to the allocator and asked for a hand-typed ID instead — in breach of the
   * rule one section above them: "Business IDs are allocated by the system when the
   * creating request does not supply one."
   */
  it("pads to a caller-declared width, for the three-digit catalogue levels", () => {
    expect(formatBusinessId("REQ", 1, 3)).toBe("REQ001");
    expect(formatBusinessId("REQ", 42, 3)).toBe("REQ042");
    expect(formatBusinessId("PROD", 999, 3)).toBe("PROD999");
    expect(formatBusinessId("FEAT", 7, 3)).toBe("FEAT007");
  });

  it("defaults to four digits, so every existing caller is unchanged", () => {
    expect(formatBusinessId("EXE-", 1)).toBe("EXE-0001");
    expect(formatBusinessId("BUG-", 9999)).toBe("BUG-9999");
  });

  it("refuses a number past the declared width's own ceiling", () => {
    // 999 is the documented ceiling for a three-digit level, so 1000 is refused there for
    // exactly the reason 10000 is refused at four digits — the format cannot express it.
    let thrown: unknown;
    try {
      formatBusinessId("REQ", 1000, 3);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).code).toBe("ID_INVALID");
    // The message must name the space that is actually exhausted. `REQ####` would send a
    // QA Lead looking for a limit that does not exist.
    expect((thrown as AppError).message).toContain("REQ###");
    expect((thrown as AppError).message).toContain("1000");
  });

  it("still accepts the last id inside the declared width", () => {
    expect(formatBusinessId("REQ", 999, 3)).toBe("REQ999");
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
