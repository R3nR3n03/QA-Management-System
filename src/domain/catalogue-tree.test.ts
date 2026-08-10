import { describe, expect, it } from "vitest";
import {
  assembleTree,
  DEFAULT_CHILD_LIMIT,
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
    requirementCounts: new Map([
      ["f1", 2],
      ["f2", 1]
    ]),
    openProductIds: new Set(),
    openModuleIds: new Set(),
    ...over
  });
}

/** The Checkout module, once the branch above it has been opened. */
const checkoutOf = (result: ReturnType<typeof tree>) =>
  result.products[0].modules?.find((m) => m.businessId === "MOD002");

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
    expect(checkoutOf(result)?.features?.map((f) => f.businessId)).toEqual(["FEAT001", "FEAT002"]);
  });

  // A feature is the leaf of the tree, but the badge beside it still has to say how much
  // is behind it — that number is what decides whether opening the record is worth it.
  it("carries a feature's requirement count without loading requirements", () => {
    const result = tree({
      openProductIds: new Set(["p1"]),
      openModuleIds: new Set(["m2"])
    });
    const [cardCapture, threeDS] = checkoutOf(result)?.features ?? [];
    expect(cardCapture.requirementCount).toBe(2);
    expect(threeDS.requirementCount).toBe(1);
    // Nothing on a feature holds requirement rows — that is the point of stopping here.
    expect(Object.keys(cardCapture).sort()).toEqual([
      "businessId",
      "id",
      "name",
      "requirementCount"
    ]);
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
});

/**
 * The cap is the reason a branch cannot decide how big the tree is. One module with 400
 * features used to render 400 rows; now it renders `childLimit` of them and says how many
 * it is holding back, and the detail panel — which pages every child list — reads the rest.
 */
describe("assembleTree — the child cap", () => {
  const many = (n: number, parentId: string): ModuleRow[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `m${i}`,
      businessId: `MOD${String(i).padStart(3, "0")}`,
      name: `Module ${i}`,
      productId: parentId
    }));

  it("draws every child when the branch fits", () => {
    const result = tree({ openProductIds: new Set(["p1"]), childLimit: 10 });
    expect(result.products[0].modules).toHaveLength(2);
    expect(result.products[0].hiddenModules).toBe(0);
  });

  it("draws the first `childLimit` and reports the rest as hidden", () => {
    const result = tree({
      modules: many(120, "p1"),
      moduleCounts: new Map([["p1", 120]]),
      openProductIds: new Set(["p1"]),
      childLimit: 25
    });
    expect(result.products[0].modules).toHaveLength(25);
    expect(result.products[0].hiddenModules).toBe(95);
  });

  // The hidden number describes the CATALOGUE, not the fetch: it is what tells a QA Lead
  // the branch is big enough to be worth opening as a record rather than as a twist.
  it("measures hidden against the branch's real total", () => {
    const result = tree({
      modules: many(30, "p1"),
      moduleCounts: new Map([["p1", 4000]]),
      openProductIds: new Set(["p1"]),
      childLimit: 10
    });
    expect(result.products[0].hiddenModules).toBe(3990);
  });

  // A stale or disagreeing count must not produce a negative "+ -3 more".
  it("never reports a negative hidden count", () => {
    const result = tree({
      modules: many(30, "p1"),
      moduleCounts: new Map([["p1", 2]]),
      openProductIds: new Set(["p1"]),
      childLimit: 10
    });
    expect(result.products[0].hiddenModules).toBe(0);
  });

  it("caps features the same way", () => {
    const wide: FeatureRow[] = Array.from({ length: 80 }, (_, i) => ({
      id: `f${i}`,
      businessId: `FEAT${String(i).padStart(3, "0")}`,
      name: `Feature ${i}`,
      moduleId: "m2"
    }));
    const result = tree({
      features: wide,
      featureCounts: new Map([["m2", 80]]),
      openProductIds: new Set(["p1"]),
      openModuleIds: new Set(["m2"]),
      childLimit: 12
    });
    expect(checkoutOf(result)?.features).toHaveLength(12);
    expect(checkoutOf(result)?.hiddenFeatures).toBe(68);
  });

  // The root is a branch like any other. A catalogue that grows to 400 products must not
  // ship 400 rows before anyone has expanded anything.
  it("caps the product list itself", () => {
    const wide: NodeRow[] = Array.from({ length: 90 }, (_, i) => ({
      id: `p${i}`,
      businessId: `PROD${String(i).padStart(3, "0")}`,
      name: `Product ${i}`
    }));
    const result = assembleTree({
      products: wide,
      modules: [],
      features: [],
      moduleCounts: none,
      featureCounts: none,
      requirementCounts: none,
      openProductIds: new Set(),
      openModuleIds: new Set(),
      childLimit: 20,
      productTotal: 400
    });
    expect(result.products).toHaveLength(20);
    expect(result.hiddenProducts).toBe(380);
  });

  it("defaults the cap when the caller does not set one", () => {
    expect(DEFAULT_CHILD_LIMIT).toBeGreaterThan(0);
    const wide: ModuleRow[] = many(DEFAULT_CHILD_LIMIT + 5, "p1");
    const result = tree({
      modules: wide,
      moduleCounts: new Map([["p1", wide.length]]),
      openProductIds: new Set(["p1"])
    });
    expect(result.products[0].modules).toHaveLength(DEFAULT_CHILD_LIMIT);
    expect(result.products[0].hiddenModules).toBe(5);
  });

  // A closed branch draws nothing, so it is holding nothing back — "+ 12 more" beside a
  // chevron nobody has clicked would be a promise about a fetch that never happened.
  it("reports no hidden children for a closed branch", () => {
    const result = tree({ moduleCounts: new Map([["p1", 900]]) });
    expect(result.products[0].modules).toBeNull();
    expect(result.products[0].hiddenModules).toBe(0);
  });
});
