import { describe, expect, it } from "vitest";
import {
  dropExplicitCloses,
  groupCandidates,
  isFiltering,
  RENDER_LIMIT,
  type GroupCandidatesInput,
  type PlanCandidate,
  type PlanFilters
} from "./plan-grouping";

const candidate = (over: Partial<PlanCandidate> & { id: string }): PlanCandidate => ({
  businessId: `TC-X-${over.id}`,
  title: `Case ${over.id}`,
  priority: "High",
  severity: "Major",
  productId: "prod-1",
  featureId: "feat-1",
  featureBusinessId: "FEAT001",
  featureName: "Card payment",
  moduleName: "Checkout",
  requirementId: "req-1",
  requirementBusinessId: "REQ001",
  ...over
});

const NO_FILTERS: PlanFilters = {
  needle: "",
  productId: "",
  requirementId: "",
  onlySelected: false
};

const NONE: ReadonlySet<string> = new Set();
const NO_OVERRIDE: ReadonlyMap<string, boolean> = new Map();

/** Defaults for everything the case under test is not about. */
const group = (over: Partial<GroupCandidatesInput> & { cases: PlanCandidate[] }) =>
  groupCandidates({
    filters: NO_FILTERS,
    selected: NONE,
    openOverride: NO_OVERRIDE,
    ...over
  });

/** Two features, so ordering and bucketing both have something to prove. */
const TWO_FEATURES = [
  candidate({ id: "b1", featureId: "feat-b", featureBusinessId: "FEAT002", featureName: "Refunds" }),
  candidate({ id: "a1", featureId: "feat-a", featureBusinessId: "FEAT001", featureName: "Card payment" }),
  candidate({ id: "b2", featureId: "feat-b", featureBusinessId: "FEAT002", featureName: "Refunds" })
];

describe("groupCandidates", () => {
  it("buckets candidates into one group per feature, ordered by feature business ID", () => {
    const { groups } = group({ cases: TWO_FEATURES });

    expect(groups.map((one) => one.featureBusinessId)).toEqual(["FEAT001", "FEAT002"]);
    expect(groups.map((one) => one.matching.map((each) => each.id))).toEqual([["a1"], ["b1", "b2"]]);
  });

  it("carries the labels a header needs", () => {
    const [first] = group({ cases: TWO_FEATURES }).groups;

    expect(first.featureName).toBe("Card payment");
    expect(first.moduleName).toBe("Checkout");
  });

  // The whole point of grouping: the shape of the corpus is visible before any case row is.
  it("starts every group closed, rendering no case rows at all", () => {
    const grouping = group({ cases: TWO_FEATURES });

    expect(grouping.groups.every((one) => one.open)).toBe(false);
    expect(grouping.groups.flatMap((one) => one.rendered)).toEqual([]);
    expect(grouping.renderedCount).toBe(0);
    expect(grouping.matchingCount).toBe(3);
  });
});

describe("groupCandidates open and closed", () => {
  // A rerun arrives with cases preselected. Hiding them behind a closed header would be the
  // same failure "Only selected" exists to prevent: a selection you cannot see.
  it("opens a group holding a selected case", () => {
    const { groups } = group({ cases: TWO_FEATURES, selected: new Set(["b1"]) });

    expect(groups.map((one) => [one.featureBusinessId, one.open])).toEqual([
      ["FEAT001", false],
      ["FEAT002", true]
    ]);
  });

  // Without this a search reads as finding nothing until the reader starts clicking headers.
  it("opens every group the needle matched", () => {
    const { groups } = group({ cases: TWO_FEATURES, filters: { ...NO_FILTERS, needle: "Refunds" } });

    expect(groups.map((one) => one.featureBusinessId)).toEqual(["FEAT002"]);
    expect(groups[0].open).toBe(true);
  });

  it("closes again once the needle is cleared", () => {
    const searching = group({ cases: TWO_FEATURES, filters: { ...NO_FILTERS, needle: "Refunds" } });
    expect(searching.groups[0].open).toBe(true);

    // The same corpus with nothing typed: the group the needle opened is shut again.
    const cleared = group({ cases: TWO_FEATURES });
    expect(cleared.groups.find((one) => one.featureId === "feat-b")?.open).toBe(false);
  });

  it("opens a group the reader opened by hand", () => {
    const { groups } = group({ cases: TWO_FEATURES, openOverride: new Map([["feat-a", true]]) });

    expect(groups.find((one) => one.featureId === "feat-a")?.open).toBe(true);
    expect(groups.find((one) => one.featureId === "feat-b")?.open).toBe(false);
  });

  // Otherwise a group holding a selection could never be put away, and a reader reviewing
  // twelve selected cases across four features would be stuck with all four open.
  it("lets an explicit close beat every automatic reason to open", () => {
    const { groups } = group({
      cases: TWO_FEATURES,
      filters: { ...NO_FILTERS, needle: "Refunds" },
      selected: new Set(["b1"]),
      openOverride: new Map([["feat-b", false]])
    });

    expect(groups.find((one) => one.featureId === "feat-b")?.open).toBe(false);
  });
});

/**
 * The pairing that makes "Collapse all" survivable. Collapse-all has to record an explicit
 * close on every group — that is the only way to shut one holding a selection — and an explicit
 * close outranks the needle. Left standing, the next search would match cases inside groups
 * that stay shut, with no expand-all to recover from it.
 */
describe("dropExplicitCloses", () => {
  it("forgets the closes and keeps the opens", () => {
    const kept = dropExplicitCloses(
      new Map([
        ["feat-a", true],
        ["feat-b", false],
        ["feat-c", false]
      ])
    );

    expect([...kept]).toEqual([["feat-a", true]]);
  });

  it("lets a needle reopen what a collapse-all had shut", () => {
    const collapsed = new Map([
      ["feat-a", false],
      ["feat-b", false]
    ]);

    const stuck = group({
      cases: TWO_FEATURES,
      filters: { ...NO_FILTERS, needle: "Refunds" },
      openOverride: collapsed
    });
    expect(stuck.groups[0].open).toBe(false);

    const freed = group({
      cases: TWO_FEATURES,
      filters: { ...NO_FILTERS, needle: "Refunds" },
      openOverride: dropExplicitCloses(collapsed)
    });
    expect(freed.groups[0].open).toBe(true);
  });

  it("leaves a hand-opened group open through the same reset", () => {
    const kept = dropExplicitCloses(new Map([["feat-a", true]]));

    expect(group({ cases: TWO_FEATURES, openOverride: kept }).groups[0].open).toBe(true);
  });
});

describe("isFiltering", () => {
  it("is false when nothing is narrowing the corpus", () => {
    expect(isFiltering(NO_FILTERS)).toBe(false);
    expect(isFiltering({ ...NO_FILTERS, needle: "   " })).toBe(false);
  });

  it("is true for any one of the four", () => {
    expect(isFiltering({ ...NO_FILTERS, needle: "refund" })).toBe(true);
    expect(isFiltering({ ...NO_FILTERS, productId: "prod-1" })).toBe(true);
    expect(isFiltering({ ...NO_FILTERS, requirementId: "req-1" })).toBe(true);
    expect(isFiltering({ ...NO_FILTERS, onlySelected: true })).toBe(true);
  });
});

/** Two products, and a requirement that deliberately spans both features. */
const SPANNING = [
  candidate({ id: "a1", featureId: "feat-a", featureBusinessId: "FEAT001", requirementId: "req-shared" }),
  candidate({ id: "a2", featureId: "feat-a", featureBusinessId: "FEAT001", requirementId: "req-other" }),
  candidate({
    id: "b1",
    featureId: "feat-b",
    featureBusinessId: "FEAT002",
    requirementId: "req-shared",
    productId: "prod-2"
  })
];

describe("groupCandidates filters", () => {
  it("drops a group the product filter emptied rather than showing it at zero", () => {
    const { groups } = group({ cases: SPANNING, filters: { ...NO_FILTERS, productId: "prod-2" } });

    expect(groups.map((one) => one.featureBusinessId)).toEqual(["FEAT002"]);
  });

  // The cut the grouping itself cannot make, which is why the requirement filter survives
  // while the feature dropdown does not: one requirement's cases span two features.
  it("keeps both groups when a requirement spans them", () => {
    const { groups } = group({
      cases: SPANNING,
      filters: { ...NO_FILTERS, requirementId: "req-shared" }
    });

    expect(groups.map((one) => one.matching.map((each) => each.id))).toEqual([["a1"], ["b1"]]);
  });

  it("narrows to the selection, and drops the groups that hold none of it", () => {
    const { groups } = group({
      cases: SPANNING,
      filters: { ...NO_FILTERS, onlySelected: true },
      selected: new Set(["a2"])
    });

    expect(groups.map((one) => one.matching.map((each) => each.id))).toEqual([["a2"]]);
  });

  it("matches the needle against a field a row displays but no dropdown covers", () => {
    const cases = [candidate({ id: "hot", priority: "Critical" }), candidate({ id: "cold", priority: "Low" })];

    const { groups } = group({ cases, filters: { ...NO_FILTERS, needle: "critical" } });

    expect(groups[0].matching.map((one) => one.id)).toEqual(["hot"]);
  });

  // The header reports "3 of 8". Both numbers have to describe what the filter left, or the
  // group's own select-all label would be counting something the reader cannot see.
  it("counts selected cases within what the filter left, not within the whole feature", () => {
    const cases = [candidate({ id: "in", priority: "Critical" }), candidate({ id: "out", priority: "Low" })];

    const { groups } = group({
      cases,
      filters: { ...NO_FILTERS, needle: "critical" },
      selected: new Set(["in", "out"])
    });

    expect(groups[0].matching).toHaveLength(1);
    expect(groups[0].selectedCount).toBe(1);
  });
});

/** `count` cases spread evenly over two features, both forced open. */
function twoOpenFeatures(count: number) {
  const cases = Array.from({ length: count }, (_, index) =>
    candidate(
      index % 2 === 0
        ? { id: `a${index}`, featureId: "feat-a", featureBusinessId: "FEAT001" }
        : { id: `b${index}`, featureId: "feat-b", featureBusinessId: "FEAT002" }
    )
  );
  return {
    cases,
    openOverride: new Map([
      ["feat-a", true],
      ["feat-b", true]
    ])
  };
}

describe("groupCandidates render cap", () => {
  it("renders every case when the corpus fits", () => {
    const grouping = group({ ...twoOpenFeatures(10), renderLimit: 100 });

    expect(grouping.renderedCount).toBe(10);
    expect(grouping.groups.every((one) => one.rendered.length === one.matching.length)).toBe(true);
  });

  it("never renders more rows than the cap, however many groups are open", () => {
    const grouping = group({ ...twoOpenFeatures(20), renderLimit: 6 });

    expect(grouping.renderedCount).toBe(6);
    expect(grouping.matchingCount).toBe(20);
  });

  /**
   * Truncating mid-group rather than dropping a group whole. Skipping a group that would not
   * fit loses more than the cap requires, and which group vanished would depend on its position
   * in the order — invisible and arbitrary. The partial group is detectable, which is what lets
   * the header say "showing 3 of 8".
   */
  it("fills the earlier group first and truncates the one the cap lands in", () => {
    const [first, second] = group({ ...twoOpenFeatures(20), renderLimit: 12 }).groups;

    expect(first.rendered.length).toBe(first.matching.length);
    expect(second.rendered.length).toBeLessThan(second.matching.length);
    expect(first.rendered.length + second.rendered.length).toBe(12);
  });

  // A group past the exhausted budget renders nothing at all. It stays open, and the screen has
  // to say why it is empty rather than leaving a reader to conclude the feature has no cases.
  it("can leave a later open group with nothing rendered once the budget is spent", () => {
    const [first, second] = group({ ...twoOpenFeatures(20), renderLimit: 10 }).groups;

    expect(first.rendered).toHaveLength(10);
    expect(second.open).toBe(true);
    expect(second.rendered).toEqual([]);
  });

  // A closed group spends none of the budget, which is what makes the cap almost unreachable
  // now: a reader would have to open most of the corpus to meet it.
  it("spends no budget on a closed group", () => {
    const { cases } = twoOpenFeatures(20);

    const grouping = group({ cases, openOverride: new Map([["feat-b", true]]), renderLimit: 6 });

    expect(grouping.groups.find((one) => one.featureId === "feat-a")?.rendered).toEqual([]);
    expect(grouping.renderedCount).toBe(6);
  });

  /**
   * Only the open groups' cases belong in a sentence about the cap. A closed group's cases are
   * absent because nobody opened it, and counting them would tell a reader to narrow a filter
   * that was never the reason.
   */
  it("counts what is matching in the open groups apart from the whole corpus", () => {
    const { cases } = twoOpenFeatures(20);

    const grouping = group({ cases, openOverride: new Map([["feat-a", true]]), renderLimit: 4 });

    expect(grouping.matchingCount).toBe(20);
    expect(grouping.openMatchingCount).toBe(10);
    expect(grouping.renderedCount).toBe(4);
  });

  // Every selected case without a rendered checkbox needs a hidden input, or narrowing the
  // list would quietly narrow the run.
  it("reports which ids actually have a checkbox on screen", () => {
    const grouping = group({ ...twoOpenFeatures(4), renderLimit: 100 });

    expect([...grouping.renderedIds].sort()).toEqual(["a0", "a2", "b1", "b3"]);
  });

  it("reports no rendered ids while everything is closed", () => {
    const { cases } = twoOpenFeatures(4);

    expect(group({ cases }).renderedIds.size).toBe(0);
  });

  it("defaults to the documented cap when none is given", () => {
    const grouping = group(twoOpenFeatures(RENDER_LIMIT + 40));

    expect(grouping.renderedCount).toBe(RENDER_LIMIT);
  });
});
