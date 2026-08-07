import { describe, expect, it } from "vitest";
import {
  assembleTree,
  countByParent,
  narrowToMatches,
  nodeMatches,
  type FeatureRow,
  type ModuleRow,
  type NodeRow
} from "./catalogue-tree";

const products: NodeRow[] = [
  { id: "p1", businessId: "PROD001", name: "Retail Banking" },
  { id: "p2", businessId: "PROD002", name: "Wealth" }
];

const modules: ModuleRow[] = [
  { id: "m1", businessId: "MOD001", name: "Onboarding", productId: "p1" },
  { id: "m2", businessId: "MOD002", name: "Checkout", productId: "p1" },
  { id: "m3", businessId: "MOD003", name: "Portfolio", productId: "p2" }
];

const features: FeatureRow[] = [
  { id: "f1", businessId: "FEAT001", name: "Card capture", moduleId: "m2" },
  { id: "f2", businessId: "FEAT002", name: "3-D Secure", moduleId: "m2" },
  { id: "f3", businessId: "FEAT003", name: "Rebalancing", moduleId: "m3" }
];

const none = new Map<string, number>();

function tree(over: Partial<Parameters<typeof assembleTree>[0]> = {}) {
  return assembleTree({
    products,
    modules,
    features,
    moduleCounts: new Map([
      ["p1", 2],
      ["p2", 1]
    ]),
    featureCounts: new Map([["m2", 2]]),
    requirementCounts: new Map([["f1", 8]]),
    openProductIds: new Set(),
    openModuleIds: new Set(),
    ...over
  });
}

describe("assembleTree", () => {
  // The distinction the whole explorer rests on: a closed branch has not been fetched,
  // and must not be drawn as an empty one. Reporting [] here would tell a QA Lead that a
  // product has no modules when nobody has looked yet.
  it("reports a closed branch as null, not as empty", () => {
    const result = tree();
    expect(result.products.map((p) => p.modules)).toEqual([null, null]);
  });

  // The other half of the same rule: an open branch that really is empty says so, and
  // that is what drives the "PROD004 has no modules yet" empty state.
  it("reports an open but childless branch as empty", () => {
    const result = tree({ modules: [], openProductIds: new Set(["p1"]) });
    expect(result.products[0].modules).toEqual([]);
  });

  it("loads only the branches that are open", () => {
    const result = tree({ openProductIds: new Set(["p1"]) });
    expect(result.products[0].modules?.map((m) => m.businessId)).toEqual(["MOD001", "MOD002"]);
    expect(result.products[1].modules).toBeNull();
  });

  // "Open decides what is shown" — not "whatever rows the query happened to return".
  // The features of m2 are in the input here, but no module is open, so none are drawn.
  it("ignores rows whose parent is closed, even when they were fetched", () => {
    const result = tree({ openProductIds: new Set(["p1"]) });
    expect(result.products[0].modules?.every((m) => m.features === null)).toBe(true);
  });

  it("nests features under an open module", () => {
    const result = tree({
      openProductIds: new Set(["p1"]),
      openModuleIds: new Set(["m2"])
    });
    const checkout = result.products[0].modules?.find((m) => m.businessId === "MOD002");
    expect(checkout?.features?.map((f) => f.businessId)).toEqual(["FEAT001", "FEAT002"]);
    expect(checkout?.features?.[0].requirementCount).toBe(8);
  });

  it("takes counts from the maps and falls back to zero", () => {
    const result = tree();
    expect(result.products.map((p) => p.moduleCount)).toEqual([2, 1]);
    expect(tree({ moduleCounts: none }).products.map((p) => p.moduleCount)).toEqual([0, 0]);
  });

  // A count of zero is a real answer about the catalogue, so it must survive as 0 rather
  // than being lost to a falsy check somewhere in the lookup.
  it("keeps an explicit zero count", () => {
    const result = tree({ moduleCounts: new Map([["p1", 0]]) });
    expect(result.products[0].moduleCount).toBe(0);
  });

  it("preserves the order the query returned", () => {
    const result = tree({ openProductIds: new Set(["p1", "p2"]) });
    expect(result.products.map((p) => p.businessId)).toEqual(["PROD001", "PROD002"]);
    expect(result.products[0].modules?.map((m) => m.businessId)).toEqual(["MOD001", "MOD002"]);
  });

  // null and 0 are different: nothing was searched, versus a search that found nothing.
  it("reports no match count when nothing was searched", () => {
    expect(tree().matchCount).toBeNull();
    expect(tree({ matchCount: 0 }).matchCount).toBe(0);
  });
});

describe("nodeMatches", () => {
  it("matches business ID and name, case-insensitively", () => {
    const row = { id: "f1", businessId: "FEAT001", name: "Card capture" };
    expect(nodeMatches(row, "feat0")).toBe(true);
    expect(nodeMatches(row, "CARD")).toBe(true);
    expect(nodeMatches(row, "capture")).toBe(true);
    expect(nodeMatches(row, "payment")).toBe(false);
  });

  it("treats a blank needle as no filter", () => {
    const row = { id: "f1", businessId: "FEAT001", name: "Card capture" };
    expect(nodeMatches(row, "")).toBe(true);
    expect(nodeMatches(row, "   ")).toBe(true);
  });
});

describe("narrowToMatches", () => {
  const narrow = (needle: string, featureIdsFromRequirements?: Set<string>) =>
    narrowToMatches({ products, modules, features, needle, featureIdsFromRequirements });

  // The rule that makes search worth having: a matched feature is shown where it lives,
  // not as an orphan row — which is the exact reading failure the redesign removes.
  it("pulls a matched feature's module and product in with it", () => {
    const result = narrow("3-D Secure");
    expect(result.features.map((f) => f.businessId)).toEqual(["FEAT002"]);
    expect(result.modules.map((m) => m.businessId)).toEqual(["MOD002"]);
    expect(result.products.map((p) => p.businessId)).toEqual(["PROD001"]);
  });

  // ...and everything it pulled in is expanded, or the result sits behind a closed
  // chevron where nobody finds it.
  it("expands every branch it kept", () => {
    const result = narrow("3-D Secure");
    expect(result.openProductIds.has("p1")).toBe(true);
    expect(result.openModuleIds.has("m2")).toBe(true);
  });

  // Downward, the opposite direction: asking for a product means the product AND what is
  // in it, so its modules are not filtered away for failing to match the needle themselves.
  it("keeps every module of a matched product", () => {
    const result = narrow("Retail");
    expect(result.modules.map((m) => m.businessId)).toEqual(["MOD001", "MOD002"]);
    expect(result.products.map((p) => p.businessId)).toEqual(["PROD001"]);
  });

  it("keeps every feature of a matched module", () => {
    const result = narrow("Checkout");
    expect(result.features.map((f) => f.businessId)).toEqual(["FEAT001", "FEAT002"]);
  });

  // Requirements are not tree nodes, so a requirement hit surfaces as its feature. The
  // database supplies the feature ids; the ancestor walk is the same one.
  it("surfaces a requirement match as its feature, with ancestors", () => {
    const result = narrow("nothing-matches-by-name", new Set(["f3"]));
    expect(result.features.map((f) => f.businessId)).toEqual(["FEAT003"]);
    expect(result.modules.map((m) => m.businessId)).toEqual(["MOD003"]);
    expect(result.products.map((p) => p.businessId)).toEqual(["PROD002"]);
    // The row is on screen, so it counts. Announcing "0 match" over a drawn tree would
    // have the live region contradicting the thing it describes.
    expect(result.matchCount).toBe(1);
  });

  // A product matching must not inflate the count by its 40 descendants — the number is
  // announced to screen readers as "N records match", and it has to mean that.
  it("counts direct hits only, not the descendants they drag in", () => {
    expect(narrow("Retail").matchCount).toBe(1);
    expect(narrow("MOD00").matchCount).toBe(3);
  });

  // matchCount counts NODES, not hits: several matching requirements under one feature
  // still produce exactly one row, so they must announce as one.
  it("counts a feature once however many of its requirements matched", () => {
    const bothInF1 = narrowToMatches({
      products,
      modules,
      features,
      needle: "zzz",
      featureIdsFromRequirements: new Set(["f1"])
    });
    expect(bothInF1.matchCount).toBe(1);
  });

  // ...and a feature that matches by name AND owns a matching requirement is still one.
  it("does not double-count a feature matched by name and by requirement", () => {
    const result = narrow("Card capture", new Set(["f1"]));
    expect(result.features.map((f) => f.businessId)).toEqual(["FEAT001"]);
    expect(result.matchCount).toBe(1);
  });

  it("returns nothing when the needle matches nothing", () => {
    const result = narrow("zzz");
    expect(result.products).toEqual([]);
    expect(result.modules).toEqual([]);
    expect(result.features).toEqual([]);
    expect(result.matchCount).toBe(0);
  });

  // The narrowed rows feed assembleTree directly, so the two have to agree about what
  // "open" means. This is the seam between them.
  it("produces rows assembleTree renders as a fully expanded subtree", () => {
    const narrowed = narrow("3-D Secure");
    const result = assembleTree({
      products: narrowed.products,
      modules: narrowed.modules,
      features: narrowed.features,
      moduleCounts: countByParent(narrowed.modules, (m) => m.productId),
      featureCounts: countByParent(narrowed.features, (f) => f.moduleId),
      requirementCounts: none,
      openProductIds: narrowed.openProductIds,
      openModuleIds: narrowed.openModuleIds,
      matchCount: narrowed.matchCount
    });

    expect(result.products).toHaveLength(1);
    expect(result.products[0].moduleCount).toBe(1);
    expect(result.products[0].modules?.[0].features?.[0].businessId).toBe("FEAT002");
    expect(result.matchCount).toBe(1);
  });
});

describe("countByParent", () => {
  it("counts rows per parent key", () => {
    expect([...countByParent(modules, (m) => m.productId)]).toEqual([
      ["p1", 2],
      ["p2", 1]
    ]);
  });

  it("is empty for no rows", () => {
    expect(countByParent([] as ModuleRow[], (m) => m.productId).size).toBe(0);
  });
});
