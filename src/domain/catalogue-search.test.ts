import { describe, expect, it } from "vitest";
import {
  DEFAULT_SEARCH_LIMIT,
  highlight,
  rankHits,
  scoreHit,
  type SearchHit
} from "./catalogue-search";

const hit = (over: Partial<SearchHit> & Pick<SearchHit, "kind" | "businessId" | "label">): SearchHit => ({
  id: over.id ?? over.businessId,
  trail: over.trail ?? [],
  ...over
});

const product = hit({ kind: "product", businessId: "PROD001", label: "Retail Banking" });
const moduleHit = hit({ kind: "module", businessId: "MOD004", label: "Checkout" });
const feature = hit({ kind: "feature", businessId: "FEAT012", label: "Checkout button" });
const requirement = hit({
  kind: "requirement",
  businessId: "REQ007",
  label: "A card is refused at checkout when expired"
});

describe("scoreHit", () => {
  // An exact business ID is a lookup, not a search. Nothing outranks it.
  it("puts an exact business ID first", () => {
    expect(scoreHit(moduleHit, "MOD004")).toBe(0);
    expect(scoreHit(moduleHit, "mod004")).toBe(0);
  });

  it("ranks a business ID prefix above a name prefix", () => {
    expect(scoreHit(moduleHit, "MOD")).toBeLessThan(scoreHit(moduleHit, "Check"));
  });

  // Typing the first letters of something means the thing that starts with them, not the
  // sentence that mentions them halfway through.
  it("ranks a name prefix above a name substring", () => {
    expect(scoreHit(feature, "Checkout")).toBeLessThan(scoreHit(requirement, "checkout"));
  });

  it("is case-insensitive throughout", () => {
    expect(scoreHit(feature, "CHECKOUT")).toBe(scoreHit(feature, "checkout"));
  });

  it("scores a blank needle as no signal rather than throwing", () => {
    expect(scoreHit(feature, "  ")).toBe(5);
  });
});

describe("rankHits", () => {
  // The reason ranking cannot be an ORDER BY: the four levels are four queries, and
  // concatenating them would put every product above every requirement whatever was typed.
  it("interleaves the four levels by how well each answers the needle", () => {
    const result = rankHits([requirement, feature, product, moduleHit], "MOD004");
    expect(result.hits[0].businessId).toBe("MOD004");
  });

  it("breaks a tie by depth, shallowest first", () => {
    const result = rankHits([feature, moduleHit], "Checkout");
    expect(result.hits.map((h) => h.businessId)).toEqual(["MOD004", "FEAT012"]);
  });

  it("breaks a remaining tie by business ID, so the order is stable", () => {
    const a = hit({ kind: "feature", businessId: "FEAT002", label: "Checkout" });
    const b = hit({ kind: "feature", businessId: "FEAT001", label: "Checkout" });
    expect(rankHits([a, b], "Checkout").hits.map((h) => h.businessId)).toEqual([
      "FEAT001",
      "FEAT002"
    ]);
  });

  it("shows everything and reports no truncation when the results fit", () => {
    const result = rankHits([product, moduleHit], "o", 10);
    expect(result.hits).toHaveLength(2);
    expect(result.truncated).toBe(false);
  });

  // The bound is the whole point: a two-letter needle must cost a screenful, not a table.
  it("cuts the list at the limit and says it did", () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      hit({ kind: "feature", businessId: `FEAT${String(i).padStart(3, "0")}`, label: "Checkout" })
    );
    const result = rankHits(many, "Checkout", 10);
    expect(result.hits).toHaveLength(10);
    expect(result.truncated).toBe(true);
  });

  it("does not mutate the array it was given", () => {
    const input = [requirement, product];
    rankHits(input, "Retail");
    expect(input[0]).toBe(requirement);
  });

  it("defaults to the shipped limit", () => {
    const many = Array.from({ length: DEFAULT_SEARCH_LIMIT + 3 }, (_, i) =>
      hit({ kind: "feature", businessId: `FEAT${String(i).padStart(3, "0")}`, label: "x" })
    );
    expect(rankHits(many, "FEAT").hits).toHaveLength(DEFAULT_SEARCH_LIMIT);
  });

  it("returns an empty, untruncated result for no hits", () => {
    expect(rankHits([], "anything")).toEqual({ hits: [], truncated: false });
  });
});

describe("highlight", () => {
  it("splits a label around the needle", () => {
    expect(highlight("Checkout button", "button")).toEqual({
      before: "Checkout ",
      match: "button",
      after: ""
    });
  });

  // Found case-insensitively, but shown in the record's own capitalisation — the row is
  // quoting the catalogue, not the search box.
  it("keeps the original casing in the marked slice", () => {
    expect(highlight("Checkout button", "CHECKOUT")?.match).toBe("Checkout");
  });

  it("marks only the first occurrence", () => {
    expect(highlight("card card", "card")).toEqual({
      before: "",
      match: "card",
      after: " card"
    });
  });

  // Normal, not an error: a hit found by its business ID has a label the needle is not in.
  it("is null when the needle is not in the text", () => {
    expect(highlight("Checkout", "wealth")).toBeNull();
  });

  it("is null for a blank needle", () => {
    expect(highlight("Checkout", "")).toBeNull();
    expect(highlight("Checkout", "   ")).toBeNull();
  });
});
