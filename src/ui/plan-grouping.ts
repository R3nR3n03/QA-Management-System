/**
 * Turning the approved corpus into the feature groups the plan picker renders.
 *
 * Extracted from `PlanForm` rather than living inside it because the rules here stopped being
 * incidental: which cases a filter leaves, which groups are open, and how a bounded number of
 * rendered rows is spread across groups are four interacting inputs and a cap that crosses
 * group boundaries. That wants a table of cases, not an assertion per rendered DOM — the same
 * split `src/domain/catalogue-tree.ts` uses for the same reason.
 *
 * Pure: no React, no DOM, no fetch.
 */

/** One approved case, as the picker needs it. */
export type PlanCandidate = {
  id: string;
  businessId: string;
  title: string;
  priority: string;
  severity: string;
  productId: string;
  featureId: string;
  featureBusinessId: string;
  requirementId: string;
  requirementBusinessId: string;
  moduleName: string;
  featureName: string;
  /**
   * The case's latest automation check and how many it has ever had, or null when it has
   * none. Read-only context a row displays — deliberately absent from `haystack()` below,
   * so the needle cannot filter by it; see the picker's own automation indicator.
   */
  automation?: { outcome: string; count: number } | null;
};

/**
 * How many case rows may be in the DOM at once, across every open group.
 *
 * Collapsing is a convention — a reader may open everything — so this stays the guarantee that
 * the browser never lays out an unbounded list. Global rather than per group: eleven separate
 * caps would produce eleven separate partial lists and no honest total.
 */
export const RENDER_LIMIT = 100;

export type PlanFilters = {
  /**
   * The text a planner typed, before anything has been matched with it (`CONTEXT.md`). Not
   * `query`, which that entry names as the word to avoid.
   */
  needle: string;
  productId: string;
  requirementId: string;
  /** Narrow to what is already selected, for a review before committing. */
  onlySelected: boolean;
};

export type PlanGroup = {
  featureId: string;
  featureBusinessId: string;
  featureName: string;
  moduleName: string;
  open: boolean;
  /** Everything in this feature the filters left, in the order it arrived. */
  matching: PlanCandidate[];
  /**
   * The prefix of `matching` that gets a real checkbox. Empty while the group is closed, and
   * shorter than `matching` where the render cap ran out mid-group.
   */
  rendered: PlanCandidate[];
  /** Of `matching`, how many are selected — the "3 of 8" a header reports. */
  selectedCount: number;
};

export type PlanGrouping = {
  groups: PlanGroup[];
  /** Across every group, how many cases the filters left. */
  matchingCount: number;
  /**
   * Across the OPEN groups only, how many cases the filters left.
   *
   * Separate from `matchingCount` because only this number belongs in a sentence about the
   * render cap: a closed group's cases are absent because nobody opened it, and blaming the cap
   * for them would tell a reader to narrow a filter that was never the reason.
   */
  openMatchingCount: number;
  /** Across every group, how many case rows are rendered. */
  renderedCount: number;
  /**
   * Ids with a real checkbox on screen. Anything selected and NOT in here needs a hidden
   * input, or narrowing the list would quietly narrow the run.
   */
  renderedIds: ReadonlySet<string>;
};

export type GroupCandidatesInput = {
  cases: PlanCandidate[];
  filters: PlanFilters;
  selected: ReadonlySet<string>;
  /**
   * The reader's explicit open/closed choices, by feature id. Absent means "follow the
   * automatic rules", which is not the same as closed — see `isOpen`.
   */
  openOverride: ReadonlyMap<string, boolean>;
  /**
   * Defaults to `RENDER_LIMIT`. A parameter so the cap's behaviour can be exercised on a
   * handful of cases instead of a fabricated corpus of hundreds — the same reason
   * `catalogue-tree.ts` takes its child limit as input.
   */
  renderLimit?: number;
};

/** Is anything narrowing the corpus right now? */
export function isFiltering(filters: PlanFilters): boolean {
  return (
    filters.needle.trim() !== "" ||
    filters.productId !== "" ||
    filters.requirementId !== "" ||
    filters.onlySelected
  );
}

/**
 * Keeps the reader's explicit OPENS and forgets their explicit closes.
 *
 * Called when the needle changes, and it is what stops "Collapse all" from disabling search for
 * the rest of the session. Collapse-all necessarily records an explicit close on every group —
 * that is the only way to shut one holding a selection — and an explicit close outranks every
 * automatic reason to open, the needle included. Left standing, the next search would match
 * cases inside groups that stay shut, with no expand-all to recover: the reader would see
 * headers and no rows.
 *
 * Opens survive because a group someone opened by hand must not close itself when they search
 * (`docs`-free UI rule, settled with the QA Lead): the needle adds openings, it never closes
 * what the reader chose to look at.
 */
export function dropExplicitCloses(
  openOverride: ReadonlyMap<string, boolean>
): ReadonlyMap<string, boolean> {
  return new Map([...openOverride].filter(([, open]) => open));
}

/**
 * Everything about a candidate the needle can match.
 *
 * Built from the fields a row displays, deliberately: a needle that matches something
 * invisible looks broken, and a visible field the needle ignores looks broken the other way.
 */
function haystack(candidate: PlanCandidate): string {
  return [
    candidate.businessId,
    candidate.title,
    candidate.moduleName,
    candidate.featureName,
    candidate.requirementBusinessId,
    candidate.priority,
    candidate.severity
  ]
    .join(" ")
    .toLowerCase();
}

/** A feature and the cases of it the filters left, before anything is decided about display. */
type Bucket = Pick<
  PlanGroup,
  "featureId" | "featureBusinessId" | "featureName" | "moduleName" | "matching" | "selectedCount"
>;

/**
 * Groups the corpus, applies the filters within each group, and decides what is open and what
 * is rendered.
 */
export function groupCandidates({
  cases,
  filters,
  selected,
  openOverride,
  renderLimit = RENDER_LIMIT
}: GroupCandidatesInput): PlanGrouping {
  const needle = filters.needle.trim().toLowerCase();

  const buckets = new Map<string, Bucket>();
  for (const one of cases) {
    if (filters.onlySelected && !selected.has(one.id)) continue;
    if (filters.productId !== "" && one.productId !== filters.productId) continue;
    if (filters.requirementId !== "" && one.requirementId !== filters.requirementId) continue;
    if (needle !== "" && !haystack(one).includes(needle)) continue;

    const existing = buckets.get(one.featureId);
    if (existing) {
      existing.matching.push(one);
      if (selected.has(one.id)) existing.selectedCount += 1;
      continue;
    }

    buckets.set(one.featureId, {
      featureId: one.featureId,
      featureBusinessId: one.featureBusinessId,
      featureName: one.featureName,
      moduleName: one.moduleName,
      matching: [one],
      selectedCount: selected.has(one.id) ? 1 : 0
    });
  }

  // A bucket with nothing matching never exists, so a filter that empties a feature removes its
  // header rather than leaving a row that says zero.
  const ordered = [...buckets.values()].sort((a, b) =>
    a.featureBusinessId.localeCompare(b.featureBusinessId)
  );

  // Display is decided in a second pass because the cap is spent in group order, so a group's
  // `rendered` depends on the groups before it. Each `PlanGroup` is built once and completely:
  // nothing here reassigns a field, so no group is ever briefly describing something untrue.
  let budget = renderLimit;
  const renderedIds = new Set<string>();

  const groups = ordered.map((bucket) => {
    const open = isOpen(bucket, needle, openOverride);
    // Truncating mid-group is deliberate. Skipping a group that would not fit whole loses more
    // than the cap requires, and WHICH group vanished would depend on its position in the
    // order — invisible and arbitrary. A partial group says so on screen.
    const rendered = open ? bucket.matching.slice(0, budget) : [];

    budget -= rendered.length;
    for (const one of rendered) renderedIds.add(one.id);

    return { ...bucket, open, rendered };
  });

  return {
    groups,
    matchingCount: groups.reduce((total, group) => total + group.matching.length, 0),
    openMatchingCount: groups.reduce(
      (total, group) => total + (group.open ? group.matching.length : 0),
      0
    ),
    renderedCount: renderLimit - budget,
    renderedIds
  };
}

/**
 * Closed unless there is something in there the reader needs to see.
 *
 * An explicit choice always wins, so a group can be closed even while it holds a selection —
 * otherwise a reader could not put away a group they had finished with. Absent a choice, a
 * group opens when it holds a selected case (a rerun's preselection must not start hidden) or
 * when the needle matched inside it (a search that appears to find nothing is worse than no
 * search at all).
 *
 * A needle only ever reaches this function alongside groups it already matched — one that
 * matched nothing was filtered out of existence — so a non-empty needle means "this group has
 * a hit in it".
 */
function isOpen(
  bucket: Bucket,
  needle: string,
  openOverride: ReadonlyMap<string, boolean>
): boolean {
  const chosen = openOverride.get(bucket.featureId);
  if (chosen !== undefined) return chosen;

  return bucket.selectedCount > 0 || needle !== "";
}
