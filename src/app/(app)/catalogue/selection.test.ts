import { describe, expect, it } from "vitest";
import {
  isSelected,
  parseSelection,
  readSelection,
  selectionHref,
  selectionParam
} from "./selection";

describe("parseSelection", () => {
  it("reads each of the three selectable kinds", () => {
    expect(parseSelection("p:PROD001")).toEqual({ kind: "product", businessId: "PROD001" });
    expect(parseSelection("m:MOD004")).toEqual({ kind: "module", businessId: "MOD004" });
    expect(parseSelection("f:FEAT012")).toEqual({ kind: "feature", businessId: "FEAT012" });
  });

  it("accepts a lower-case URL", () => {
    expect(parseSelection("m:mod004")).toEqual({ kind: "module", businessId: "MOD004" });
    expect(parseSelection("M:MOD004")).toEqual({ kind: "module", businessId: "MOD004" });
  });

  // A hand-edited URL should show the overview, not reach the database for a row that
  // could not exist. The pattern is the same one the domain enforces on write.
  it("rejects a business ID that does not match its kind's documented format", () => {
    expect(parseSelection("m:PROD001")).toBeNull();
    expect(parseSelection("p:MOD001")).toBeNull();
    expect(parseSelection("f:FEAT1")).toBeNull();
    expect(parseSelection("m:MOD0001")).toBeNull();
    expect(parseSelection("m:MOD00A")).toBeNull();
  });

  it("rejects anything that is not a known kind", () => {
    expect(parseSelection("r:REQ001")).toBeNull();
    expect(parseSelection("x:MOD001")).toBeNull();
    expect(parseSelection("MOD001")).toBeNull();
    expect(parseSelection(":MOD001")).toBeNull();
  });

  it("reads a missing or empty parameter as no selection", () => {
    expect(parseSelection(undefined)).toBeNull();
    expect(parseSelection("")).toBeNull();
  });

  // Requirements are rows in a feature's panel, never tree nodes, so they are not a
  // selectable kind — and a URL claiming otherwise must not half-work.
  it("does not accept a requirement as a selection", () => {
    expect(parseSelection("q:REQ001")).toBeNull();
  });
});

describe("selectionParam", () => {
  it("round-trips every kind", () => {
    for (const raw of ["p:PROD001", "m:MOD004", "f:FEAT012"]) {
      const parsed = parseSelection(raw);
      expect(parsed).not.toBeNull();
      expect(selectionParam(parsed!)).toBe(raw);
    }
  });
});

describe("readSelection", () => {
  it("reads the sel parameter out of a page's searchParams", () => {
    expect(readSelection({ sel: "m:MOD004" })).toEqual({ kind: "module", businessId: "MOD004" });
    expect(readSelection({})).toBeNull();
    expect(readSelection(undefined)).toBeNull();
  });

  // Next hands a repeated parameter through as an array; readParam takes the first.
  it("takes the first of a repeated parameter", () => {
    expect(readSelection({ sel: ["m:MOD004", "p:PROD001"] })).toEqual({
      kind: "module",
      businessId: "MOD004"
    });
  });
});

describe("isSelected", () => {
  const selection = { kind: "module" as const, businessId: "MOD004" };

  it("matches only the same kind and the same ID", () => {
    expect(isSelected(selection, "module", "MOD004")).toBe(true);
    expect(isSelected(selection, "module", "MOD005")).toBe(false);
    expect(isSelected(selection, "product", "MOD004")).toBe(false);
    expect(isSelected(null, "module", "MOD004")).toBe(false);
  });
});

describe("selectionHref", () => {
  it("sets the selection", () => {
    expect(selectionHref({}, { kind: "module", businessId: "MOD004" })).toBe("/catalogue?sel=m%3AMOD004");
  });

  it("clears the selection back to the overview", () => {
    expect(selectionHref({ sel: "m:MOD004" }, null)).toBe("/catalogue");
  });

  // The needle is the viewer's, not the selection's: clicking a search result must not
  // silently discard the search that produced it.
  it("carries the search needle through a selection change", () => {
    const href = selectionHref({ q: "checkout" }, { kind: "feature", businessId: "FEAT012" });
    expect(href).toContain("q=checkout");
    expect(href).toContain("sel=f%3AFEAT012");
  });

  // ?req=3 belongs to the list of the record being left. Carried onto a different
  // feature it lands the viewer past the end of a list they have never seen — the
  // failure src/ui/list-empty.tsx exists to explain.
  it("drops the requirement page when the selection changes", () => {
    expect(selectionHref({ sel: "f:FEAT011", req: "3" }, { kind: "feature", businessId: "FEAT012" })).toBe(
      "/catalogue?sel=f%3AFEAT012"
    );
  });
});
