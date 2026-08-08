import { describe, expect, it } from "vitest";
import {
  collapseAllHref,
  isSelected,
  kindOfBusinessId,
  MAX_OPEN_NODES,
  openParamValue,
  parseOpenSet,
  parseSelection,
  readOpenSet,
  readSelection,
  selectionHref,
  selectionParam,
  toggleOpenHref
} from "./selection";

describe("parseSelection", () => {
  it("reads each of the four selectable kinds", () => {
    expect(parseSelection("p:PROD001")).toEqual({ kind: "product", businessId: "PROD001" });
    expect(parseSelection("m:MOD004")).toEqual({ kind: "module", businessId: "MOD004" });
    expect(parseSelection("f:FEAT012")).toEqual({ kind: "feature", businessId: "FEAT012" });
    expect(parseSelection("r:REQ007")).toEqual({ kind: "requirement", businessId: "REQ007" });
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
    expect(parseSelection("r:FEAT001")).toBeNull();
  });

  it("rejects anything that is not a known kind", () => {
    expect(parseSelection("x:MOD001")).toBeNull();
    expect(parseSelection("MOD001")).toBeNull();
    expect(parseSelection(":MOD001")).toBeNull();
  });

  it("reads a missing or empty parameter as no selection", () => {
    expect(parseSelection(undefined)).toBeNull();
    expect(parseSelection("")).toBeNull();
  });

  // `q` is the search needle. Reusing that letter as a selection prefix would put two
  // meanings for it in one URL, so requirements take `r`.
  it("does not treat the needle's letter as a kind", () => {
    expect(parseSelection("q:REQ001")).toBeNull();
  });
});

describe("selectionParam", () => {
  it("round-trips every kind", () => {
    for (const raw of ["p:PROD001", "m:MOD004", "f:FEAT012", "r:REQ007"]) {
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

  // ?c=3 belongs to the child list of the record being left. Carried onto a different
  // record it lands the viewer past the end of a list they have never seen — the
  // failure src/ui/list-empty.tsx exists to explain.
  it("drops the child page when the selection changes", () => {
    expect(selectionHref({ sel: "f:FEAT011", c: "3" }, { kind: "feature", businessId: "FEAT012" })).toBe(
      "/catalogue?sel=f%3AFEAT012"
    );
  });

  // The shape of the tree is the viewer's, not the selection's. Choosing a record used to
  // collapse the branch it was in, because one link carried both meanings.
  it("keeps the open branches when the selection changes", () => {
    const href = selectionHref({ open: "PROD001.MOD002" }, { kind: "module", businessId: "MOD004" });
    expect(href).toContain("open=PROD001.MOD002");
    expect(href).toContain("sel=m%3AMOD004");
  });
});

describe("kindOfBusinessId", () => {
  it("reads the level off the ID's own format", () => {
    expect(kindOfBusinessId("PROD001")).toBe("product");
    expect(kindOfBusinessId("MOD004")).toBe("module");
    expect(kindOfBusinessId("FEAT012")).toBe("feature");
    expect(kindOfBusinessId("REQ007")).toBe("requirement");
    expect(kindOfBusinessId("TC-X-0001")).toBeNull();
    expect(kindOfBusinessId("nonsense")).toBeNull();
  });
});

describe("parseOpenSet", () => {
  it("reads a dot-separated list of business IDs", () => {
    expect([...parseOpenSet("PROD001.MOD004")]).toEqual(["PROD001", "MOD004"]);
  });

  it("reads a missing or empty parameter as nothing open", () => {
    expect(parseOpenSet(undefined).size).toBe(0);
    expect(parseOpenSet("").size).toBe(0);
  });

  it("accepts a lower-case URL and de-duplicates", () => {
    expect([...parseOpenSet("prod001.PROD001")]).toEqual(["PROD001"]);
  });

  // Same contract as parseSelection: a hand-edited URL degrades to a sensible tree.
  it("drops anything that is not an expandable business ID", () => {
    expect([...parseOpenSet("PROD001.whatever.MOD9.")]).toEqual(["PROD001"]);
  });

  // The tree stops at Feature, so neither a feature nor a requirement is a branch.
  // Accepting one would put an id in the open set that no query can ever act on.
  it("drops the levels that cannot be open", () => {
    expect([...parseOpenSet("REQ001.FEAT012.MOD004")]).toEqual(["MOD004"]);
  });

  // Each open branch becomes a row in the tree fetch's IN (…). A pasted URL must not be
  // able to turn one page load into an unbounded query.
  it("stops at MAX_OPEN_NODES", () => {
    const many = Array.from({ length: MAX_OPEN_NODES + 20 }, (_, i) =>
      `MOD${String(i % 1000).padStart(3, "0")}`
    ).join(".");
    expect(parseOpenSet(many).size).toBe(MAX_OPEN_NODES);
  });
});

describe("readOpenSet", () => {
  it("reads the open parameter out of a page's searchParams", () => {
    expect([...readOpenSet({ open: "PROD001.MOD004" })]).toEqual(["PROD001", "MOD004"]);
    expect(readOpenSet({}).size).toBe(0);
    expect(readOpenSet(undefined).size).toBe(0);
  });
});

describe("openParamValue", () => {
  it("is null when nothing is open, so the key leaves the URL", () => {
    expect(openParamValue(new Set())).toBeNull();
    expect(openParamValue(new Set(["PROD001", "MOD004"]))).toBe("PROD001.MOD004");
  });
});

describe("toggleOpenHref", () => {
  it("opens a branch that was closed", () => {
    expect(toggleOpenHref({}, "PROD001")).toBe("/catalogue?open=PROD001");
  });

  it("closes a branch that was open", () => {
    expect(toggleOpenHref({ open: "PROD001.MOD004" }, "MOD004")).toBe("/catalogue?open=PROD001");
  });

  it("leaves the URL clean when the last branch closes", () => {
    expect(toggleOpenHref({ open: "PROD001" }, "PROD001")).toBe("/catalogue");
  });

  /**
   * The whole point of the second parameter. Expanding a branch is looking around: it must
   * not choose a record, empty the detail panel, or reset the requirement page. The screen
   * shipped with one link doing both, which is why a second click on an open product threw
   * the selection away and collapsed the tree.
   */
  it("touches nothing but the open set", () => {
    const href = toggleOpenHref({ sel: "f:FEAT012", q: "checkout", c: "3" }, "PROD001");
    expect(href).toContain("sel=f%3AFEAT012");
    expect(href).toContain("q=checkout");
    expect(href).toContain("c=3");
    expect(href).toContain("open=PROD001");
  });
});

/**
 * Twelve open branches take twelve clicks to undo, and each one is a server round trip.
 * Collapsing is looking around, exactly as expanding is, so it must leave the selection
 * and the needle where they were.
 */
describe("collapseAllHref", () => {
  it("shuts every branch", () => {
    expect(collapseAllHref({ open: "PROD001.MOD004.MOD007" })).toBe("/catalogue");
  });

  it("keeps the selection, the needle and the child page", () => {
    const href = collapseAllHref({ open: "PROD001", sel: "m:MOD004", q: "checkout", c: "2" });
    expect(href).toContain("sel=m%3AMOD004");
    expect(href).toContain("q=checkout");
    expect(href).toContain("c=2");
    expect(href).not.toContain("open=");
  });

  it("is a no-op on a tree that is already collapsed", () => {
    expect(collapseAllHref({})).toBe("/catalogue");
  });
});
