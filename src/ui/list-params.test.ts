import { describe, expect, it } from "vitest";
import { hrefWith, readPage, readParam } from "./list-params";

/**
 * The query string is the state now, so these are the rules the whole list idiom rests
 * on: a hand-edited URL must degrade to page 1 rather than throw, and rewriting one
 * parameter must not disturb the others — the catalogue screen pages four lists at once.
 */

describe("readParam", () => {
  it("trims, and reads the first of a repeated parameter", () => {
    expect(readParam({ q: "  login  " }, "q")).toBe("login");
    expect(readParam({ q: ["first", "second"] }, "q")).toBe("first");
  });

  it("is empty for a missing key, undefined params, or a non-string", () => {
    expect(readParam({}, "q")).toBe("");
    expect(readParam(undefined, "q")).toBe("");
    expect(readParam({ q: undefined }, "q")).toBe("");
  });
});

describe("readPage", () => {
  it("reads a 1-based page", () => {
    expect(readPage({ page: "3" })).toBe(3);
    expect(readPage({ products: "2" }, "products")).toBe(2);
  });

  it("falls back to page 1 rather than throwing on anything unusable", () => {
    for (const raw of ["", "0", "-4", "abc", "NaN", "Infinity"]) {
      expect(readPage({ page: raw })).toBe(1);
    }
    expect(readPage(undefined)).toBe(1);
  });

  it("floors a fractional page", () => {
    expect(readPage({ page: "2.9" })).toBe(2);
  });
});

describe("hrefWith", () => {
  it("preserves the parameters it was not asked to change", () => {
    // The catalogue case: turning the modules page must leave products alone.
    expect(hrefWith("/catalogue", { products: "2", modules: "1" }, { modules: 3 })).toBe(
      "/catalogue?products=2&modules=3"
    );
  });

  it("removes a key set to null or empty, so a cleared filter leaves a clean URL", () => {
    expect(hrefWith("/test-cases", { q: "login", page: "2" }, { q: null })).toBe("/test-cases?page=2");
    expect(hrefWith("/test-cases", { page: "2" }, { page: null })).toBe("/test-cases");
  });

  it("drops empty incoming values instead of echoing `?q=`", () => {
    expect(hrefWith("/defects", { q: "" }, {})).toBe("/defects");
  });

  it("takes the first value of a repeated incoming parameter", () => {
    expect(hrefWith("/defects", { q: ["a", "b"] }, { page: 2 })).toBe("/defects?q=a&page=2");
  });

  it("encodes values", () => {
    expect(hrefWith("/defects", {}, { q: "a b&c" })).toBe("/defects?q=a+b%26c");
  });
});
