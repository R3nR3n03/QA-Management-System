import { describe, expect, it } from "vitest";
import {
  assembleTree,
  countByParent,
  narrowToMatches,
  nodeMatches,
  type FeatureRow,
  type ModuleRow,
  type NodeRow,
  type RequirementRow
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

const requirements: RequirementRow[] = [
  { id: "r1", businessId: "REQ001", name: "A card number is validated before capture", featureId: "f1" },
  { id: "r2", businessId: "REQ002", name: "An expired card is refused", featureId: "f1" },
  { id: "r3", businessId: "REQ003", name: "A challenge is issued when flagged", featureId: "f2" }
];

const none = new Map<string, number>();

function tree(over: Partial<Parameters<typeof assembleTree>[0]> = {}) {
  return assembleTree({
    products,
    modules,
    features,
    requirements,
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
    openFeatureIds: new Set(),
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
    expect(checkoutOf(result)?.features?.[0].requirementCount).toBe(2);
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

describe("assembleTree — the requirement level", () => {
  const opened = (openFeatureIds: Set<string>) =>
    tree({
      openProductIds: new Set(["p1"]),
      openModuleIds: new Set(["m2"]),
      openFeatureIds
    });

  // The same closed/empty distinction as every level above, and the reason the fourth
  // level is affordable at all: at most one feature's worth is ever fetched.
  it("reports a closed feature's requirements as null", () => {
    const result = opened(new Set());
    expect(checkoutOf(result)?.features?.every((f) => f.requirements === null)).toBe(true);
  });

  it("nests requirements under the one open feature", () => {
    const result = opened(new Set(["f1"]));
    const [cardCapture, threeDS] = checkoutOf(result)?.features ?? [];

    expect(cardCapture.requirements?.map((r) => r.businessId)).toEqual(["REQ001", "REQ002"]);
    // Its sibling stays closed — one feature open at a time.
    expect(threeDS.requirements).toBeNull();
  });

  // A requirement's label is its statement. Carried through as `name` so every level of
  // the tree has one row shape.
  it("labels a requirement with its statement", () => {
    const result = opened(new Set(["f1"]));
    expect(checkoutOf(result)?.features?.[0].requirements?.[0].name).toBe(
      "A card number is validated before capture"
    );
  });

  it("reports an open feature with no requirements as empty", () => {
    const result = tree({
      requirements: [],
      openProductIds: new Set(["p1"]),
      openModuleIds: new Set(["m2"]),
      openFeatureIds: new Set(["f1"])
    });
    expect(checkoutOf(result)?.features?.[0].requirements).toEqual([]);
  });

  // The count beside a feature is the full count, not the number currently rendered —
  // it is what tells you whether opening the branch is worth it.
  it("keeps the feature's requirement count independent of what is loaded", () => {
    const result = opened(new Set(["f1"]));
    const cardCapture = checkoutOf(result)?.features?.[0];
    expect(cardCapture?.requirementCount).toBe(2);
    expect(cardCapture?.requirements).toHaveLength(2);

    const closed = opened(new Set());
    expect(closed.products[0].modules?.[1].features?.[0].requirementCount).toBe(2);
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
  const narrow = (needle: string, matchedRequirements: RequirementRow[] = []) =>
    narrowToMatches({ products, modules, features, needle, matchedRequirements });

  // The rule that makes search worth having: a matched node is shown where it lives,
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

  // THE EXCEPTION, and the reason a fourth level does not wreck search: the downward
  // sweep stops at features. Searching a common word must not empty the requirement
  // table into a 300px column.
  it("does not unfold the requirements of a matched feature", () => {
    const result = narrow("Card capture");
    expect(result.features.map((f) => f.businessId)).toEqual(["FEAT001"]);
    expect(result.requirements).toEqual([]);
    expect(result.openFeatureIds.size).toBe(0);
  });

  it("does not unfold requirements for a matched module or product either", () => {
    expect(narrow("Checkout").requirements).toEqual([]);
    expect(narrow("Retail").openFeatureIds.size).toBe(0);
  });

  // A matched requirement, by contrast, IS shown — as its own row, under its real
  // ancestors, with the feature opened to reveal it.
  it("shows a matched requirement under its opened feature", () => {
    const result = narrow("expired card", [requirements[1]]);

    expect(result.requirements.map((r) => r.businessId)).toEqual(["REQ002"]);
    expect(result.features.map((f) => f.businessId)).toEqual(["FEAT001"]);
    expect(result.modules.map((m) => m.businessId)).toEqual(["MOD002"]);
    expect(result.products.map((p) => p.businessId)).toEqual(["PROD001"]);
    expect(result.openFeatureIds.has("f1")).toBe(true);
  });

  it("opens only the features that actually contain a match", () => {
    const result = narrow("zzz", [requirements[2]]);
    expect(result.openFeatureIds.has("f2")).toBe(true);
    expect(result.openFeatureIds.has("f1")).toBe(false);
  });

  // A product matching must not inflate the count by its 40 descendants — the number is
  // announced to screen readers as "N records match", and it has to mean that.
  it("counts direct hits only, not the descendants they drag in", () => {
    expect(narrow("Retail").matchCount).toBe(1);
    expect(narrow("MOD00").matchCount).toBe(3);
  });

  // Each matched requirement is its own row now, so each counts. This is the behaviour
  // that changed when requirements became tree nodes: they used to collapse into a
  // single count for the feature above them.
  it("counts each matched requirement as its own row", () => {
    const result = narrow("zzz", [requirements[0], requirements[1]]);
    expect(result.matchCount).toBe(2);
  });

  it("counts a feature and a requirement inside it separately", () => {
    const result = narrow("Card capture", [requirements[0]]);
    expect(result.matchCount).toBe(2);
    expect(result.requirements.map((r) => r.businessId)).toEqual(["REQ001"]);
  });

  it("returns nothing when the needle matches nothing", () => {
    const result = narrow("zzz");
    expect(result.products).toEqual([]);
    expect(result.modules).toEqual([]);
    expect(result.features).toEqual([]);
    expect(result.requirements).toEqual([]);
    expect(result.matchCount).toBe(0);
  });

  // The narrowed rows feed assembleTree directly, so the two have to agree about what
  // "open" means. This is the seam between them.
  it("produces rows assembleTree renders as a fully expanded subtree", () => {
    const narrowed = narrow("expired card", [requirements[1]]);
    const result = assembleTree({
      products: narrowed.products,
      modules: narrowed.modules,
      features: narrowed.features,
      requirements: narrowed.requirements,
      moduleCounts: countByParent(narrowed.modules, (m) => m.productId),
      featureCounts: countByParent(narrowed.features, (f) => f.moduleId),
      requirementCounts: new Map([["f1", 2]]),
      openProductIds: narrowed.openProductIds,
      openModuleIds: narrowed.openModuleIds,
      openFeatureIds: narrowed.openFeatureIds,
      matchCount: narrowed.matchCount
    });

    const feature = result.products[0].modules?.[0].features?.[0];
    expect(result.products).toHaveLength(1);
    expect(result.products[0].moduleCount).toBe(1);
    expect(feature?.businessId).toBe("FEAT001");
    expect(feature?.requirements?.map((r) => r.businessId)).toEqual(["REQ002"]);
    // The badge still reports everything in the feature, not just the match on screen.
    expect(feature?.requirementCount).toBe(2);
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
