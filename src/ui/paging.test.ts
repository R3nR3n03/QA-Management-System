import { describe, expect, it } from "vitest";
import { PAGE_SIZE, clampPage, pageCount, pageRangeLabel, pageSlice } from "./paging";

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
