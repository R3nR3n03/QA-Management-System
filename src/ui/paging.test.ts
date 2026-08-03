import { describe, expect, it } from "vitest";
import {
  PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  clampPage,
  pageCount,
  pageRangeLabel,
  pageSlice,
  pageTokens
} from "./paging";

describe("pageTokens", () => {
  it("lists every page while they all fit", () => {
    expect(pageTokens(1, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("collapses to a single page for an empty or one-page list", () => {
    expect(pageTokens(1, 1)).toEqual([1]);
    expect(pageTokens(1, 0)).toEqual([1]);
  });

  it("elides the far end near the start", () => {
    // The 21-page case that motivated this: page 21 stays one click away.
    expect(pageTokens(1, 21)).toEqual([1, 2, 3, "gap", 21]);
  });

  it("elides both ends in the middle", () => {
    expect(pageTokens(10, 21)).toEqual([1, "gap", 8, 9, 10, 11, 12, "gap", 21]);
  });

  it("elides the near end at the finish", () => {
    expect(pageTokens(21, 21)).toEqual([1, "gap", 19, 20, 21]);
  });

  it("shows a lone missing page rather than an ellipsis for it", () => {
    // `1 2 3 4 5 6 7` — a gap of exactly one is never worth an ellipsis.
    expect(pageTokens(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(pageTokens(5, 8)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("never emits a page outside 1..last", () => {
    for (const [current, last] of [[1, 3], [3, 3], [2, 2], [1, 40], [40, 40], [20, 40]]) {
      const numbers = pageTokens(current, last).filter((t): t is number => t !== "gap");
      expect(numbers.every((n) => n >= 1 && n <= last)).toBe(true);
      expect([...numbers].sort((a, b) => a - b)).toEqual(numbers);
      expect(new Set(numbers).size).toBe(numbers.length);
    }
  });

  it("honours a wider or narrower span", () => {
    expect(pageTokens(10, 21, 0)).toEqual([1, "gap", 10, "gap", 21]);
    expect(pageTokens(10, 21, 4)).toEqual([1, "gap", 6, 7, 8, 9, 10, 11, 12, 13, 14, "gap", 21]);
  });
});

describe("PAGE_SIZE_OPTIONS", () => {
  it("offers the default among its choices", () => {
    expect(PAGE_SIZE_OPTIONS).toContain(PAGE_SIZE);
  });
});

describe("pageCount", () => {
  it("is at least 1, even for an empty list", () => {
    expect(pageCount(0)).toBe(1);
  });

  it("rounds partial pages up", () => {
    expect(pageCount(50)).toBe(1);
    expect(pageCount(51)).toBe(2);
    expect(pageCount(132)).toBe(3);
  });

  it("honours a custom page size", () => {
    expect(pageCount(10, 3)).toBe(4);
  });
});

describe("clampPage", () => {
  it("keeps a valid page as-is", () => {
    expect(clampPage(2, 132)).toBe(2);
  });

  it("clamps below 1 and past the last page", () => {
    expect(clampPage(0, 132)).toBe(1);
    expect(clampPage(-4, 132)).toBe(1);
    // A filter can shrink the list under the current page; the pager stays valid.
    expect(clampPage(9, 132)).toBe(3);
  });

  it("tolerates non-finite and fractional input", () => {
    expect(clampPage(Number.NaN, 132)).toBe(1);
    expect(clampPage(2.7, 132)).toBe(2);
  });
});

describe("pageSlice", () => {
  const items = Array.from({ length: 132 }, (_, i) => i + 1);

  it("returns full pages of PAGE_SIZE and the shorter last page", () => {
    expect(pageSlice(items, 1)).toHaveLength(PAGE_SIZE);
    expect(pageSlice(items, 1)[0]).toBe(1);
    expect(pageSlice(items, 2)[0]).toBe(51);
    expect(pageSlice(items, 3)).toHaveLength(32);
    expect(pageSlice(items, 3).at(-1)).toBe(132);
  });

  it("clamps an out-of-range page instead of returning nothing", () => {
    expect(pageSlice(items, 99)).toHaveLength(32);
    expect(pageSlice([], 1)).toEqual([]);
  });
});

describe("pageRangeLabel", () => {
  it("names the visible span", () => {
    expect(pageRangeLabel(132, 1)).toBe("Showing 1–50 of 132");
    expect(pageRangeLabel(132, 2)).toBe("Showing 51–100 of 132");
    expect(pageRangeLabel(132, 3)).toBe("Showing 101–132 of 132");
  });

  it("handles small and empty lists", () => {
    expect(pageRangeLabel(7, 1)).toBe("Showing 1–7 of 7");
    expect(pageRangeLabel(0, 1)).toBe("Showing 0 of 0");
  });
});
