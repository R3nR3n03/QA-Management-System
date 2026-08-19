"use client";

import { useMemo, useState } from "react";
import { FilterToolbar } from "@/ui/toolbar";
import { CHECK_OUTCOME_LABEL, CHECK_OUTCOME_TONE } from "@/ui/check-outcome";
import {
  dropExplicitCloses,
  groupCandidates,
  isFiltering,
  RENDER_LIMIT,
  type PlanCandidate,
  type PlanGroup
} from "@/ui/plan-grouping";

export type PlanProduct = { id: string; businessId: string; name: string };

/**
 * Choosing a set of Approved test cases, grouped by feature.
 *
 * Extracted from `PlanForm` when a second screen needed the same choice — generating an
 * automation naming contract. A second, divergent picker would have been two answers to one
 * question, which is the inconsistency this component exists to prevent; the grouping,
 * filtering, open/closed and render-cap rules were already in `plan-grouping.ts`, so what
 * moved here is the markup that renders them.
 *
 * ## The selection is controlled; everything else is not
 *
 * `selected` is the caller's, because the caller is what submits it and what its submit
 * button is enabled by. Search text, the product and requirement scopes, which groups are
 * open and whether the list is showing only the selection are nobody's business but this
 * component's — a caller that had to thread them would be holding state it never reads.
 *
 * ## Nothing that narrows the list may narrow the selection
 *
 * Three things narrow what is on screen — the filters, the collapsed groups, and the cap on
 * rendered rows — and none of them may narrow what is submitted. A case selected but not
 * currently rendered travels as a hidden input, the count says how many are off screen, and
 * "Only selected" makes them visible again. A submission that quietly covers less than the
 * person believed is the failure worth all of this machinery.
 *
 * Nothing here validates. The domain enforces non-empty and no-duplicates for whichever
 * caller asks; a disabled submit is a courtesy.
 */
export function CasePicker({
  cases,
  selected,
  onSelectedChange,
  name,
  products = [],
  disabled = false,
  invalid = false,
  describedBy
}: {
  cases: PlanCandidate[];
  /** The chosen case ids. Owned by the caller — see the note above. */
  selected: ReadonlySet<string>;
  onSelectedChange: (next: ReadonlySet<string>) => void;
  /** The form field the ticked ids submit under (`testCaseIds`, `cases`, …). */
  name: string;
  /** Products that actually have an Approved case; omit to leave the filter off. */
  products?: PlanProduct[];
  disabled?: boolean;
  /** The caller's server rejected this selection; marks the list, not the filters. */
  invalid?: boolean;
  /** Id of the notice carrying the rejection, for `aria-describedby`. */
  describedBy?: string;
}) {
  const [needle, setNeedle] = useState("");
  const [productId, setProductId] = useState("");
  const [requirementId, setRequirementId] = useState("");
  const [onlySelected, setOnlySelected] = useState(false);
  /**
   * The reader's explicit open/closed choices, by feature id. Absent means "follow the
   * automatic rules" — which is not the same as closed, and is why this is a Map of choices
   * rather than a Set of open ids: a group holding a selection is open until someone closes
   * it, and only an explicit `false` can express that.
   */
  const [openOverride, setOpenOverride] = useState<ReadonlyMap<string, boolean>>(() => new Map());

  /*
   * Requirement options come from the candidates themselves, not a separate catalogue fetch
   * — every case already carries its own hierarchy, so there is nothing a server round-trip
   * would add. Scoped to whatever the product left, for the same reason the callers' pages
   * only offer products with a candidate behind them: an option that empties the list on
   * selection reads as a broken filter.
   *
   * There is no feature dropdown. The groups ARE the features, and two controls doing one
   * job make a reader hunt for a difference that is not there.
   */
  const requirementOptions = useMemo(() => {
    const scoped = productId === "" ? cases : cases.filter((testCase) => testCase.productId === productId);
    const byId = new Map<string, string>();
    for (const testCase of scoped) byId.set(testCase.requirementId, testCase.requirementBusinessId);
    return [...byId.entries()]
      .map(([id, businessId]) => ({ id, businessId }))
      .sort((a, b) => a.businessId.localeCompare(b.businessId));
  }, [cases, productId]);

  const filters = useMemo(
    () => ({ needle, productId, requirementId, onlySelected }),
    [needle, productId, requirementId, onlySelected]
  );

  const grouping = useMemo(
    () => groupCandidates({ cases, filters, selected, openOverride }),
    [cases, filters, selected, openOverride]
  );

  const filtering = isFiltering(filters);
  const hiddenSelected = [...selected].filter((id) => !grouping.renderedIds.has(id));
  const anyOpen = grouping.groups.some((group) => group.open);
  /* Only a group the cap actually cut warrants the global notice. `matchingCount` exceeds
     `renderedCount` whenever anything is collapsed, which is almost always. */
  const capReached = grouping.groups.some(
    (group) => group.open && group.rendered.length < group.matching.length
  );

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectedChange(next);
  };

  const toggleGroupOpen = (group: PlanGroup) =>
    setOpenOverride((prev) => new Map(prev).set(group.featureId, !group.open));

  /* Every group explicitly closed, not merely cleared: clearing would let the automatic
     rules re-open the ones holding a selection, so the button would appear to do nothing.
     Those closes are forgotten the next time the needle changes — see `changeNeedle`. */
  const collapseAll = () =>
    setOpenOverride(new Map(grouping.groups.map((group) => [group.featureId, false])));

  /*
   * Typing forgets the reader's explicit CLOSES and keeps their opens.
   *
   * Without this, one "Collapse all" would disable search for the rest of the session: it has
   * to record a close on every group, an explicit close outranks the needle, and there is no
   * expand-all to recover with — so the next search would match cases inside groups that stay
   * shut, showing headers and no rows.
   */
  const changeNeedle = (next: string) => {
    setNeedle(next);
    setOpenOverride(dropExplicitCloses);
  };

  /*
   * Acts on what the filters left in this group, which is the number its label states —
   * never on cases a filter excluded. Where the render cap has also cut the group, the
   * label still counts everything matching and the group says "showing 3 of 8", so the
   * reader is told why fewer rows are visible than the number they clicked.
   */
  const toggleGroupSelection = (group: PlanGroup) => {
    const next = new Set(selected);
    const all = group.selectedCount === group.matching.length;
    for (const one of group.matching) {
      if (all) next.delete(one.id);
      else next.add(one.id);
    }
    onSelectedChange(next);
  };

  const showAll = () => {
    setOnlySelected(false);
    changeNeedle("");
    setProductId("");
    setRequirementId("");
  };

  const productName = products.find((product) => product.id === productId)?.name;
  const requirementName = requirementOptions.find((requirement) => requirement.id === requirementId)?.businessId;
  const scopeLabel = [productName, requirementName].filter(Boolean).join(" · ");

  /*
   * A needle earns its place once the list is long enough to be worth narrowing; the
   * product and requirement dropdowns earn theirs as soon as there is anything to offer,
   * regardless of how many candidates are on screen. Different questions, so different
   * conditions — and every option offered always has a candidate behind it (the callers'
   * pages for products; `requirementOptions` is built the same way).
   */
  const showNeedle = cases.length > 5;
  const showProducts = products.length > 0;
  const showRequirements = requirementOptions.length > 0;

  return (
    <>
      {showNeedle || showProducts || showRequirements ? (
        <div className="row">
          {showNeedle ? (
            <FilterToolbar
              value={needle}
              onChange={changeNeedle}
              placeholder="Filter by ID, title, module, feature, requirement, priority…"
              label="Filter approved test cases"
            />
          ) : null}
          {/* Products are catalogue records with no ceiling, so a dropdown rather than a
              chip row. Local state, not the URL: everything this filters is already in the
              browser, and a navigation would discard the selection built up so far. */}
          {showProducts ? (
            <select
              className="select-filter"
              aria-label="Filter by product"
              value={productId}
              onChange={(event) => {
                setProductId(event.target.value);
                // The requirement options are about to be rescoped to the new product;
                // a selection from the old scope could now match no row at all, which
                // would look like a second, unexplained filter narrowing the list.
                setRequirementId("");
              }}
              disabled={disabled}
            >
              <option value="">All products</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.businessId} · {product.name}
                </option>
              ))}
            </select>
          ) : null}
          {showRequirements ? (
            <select
              className="select-filter"
              aria-label="Filter by requirement"
              value={requirementId}
              onChange={(event) => setRequirementId(event.target.value)}
              disabled={disabled}
            >
              <option value="">All requirements</option>
              {requirementOptions.map((requirement) => (
                <option key={requirement.id} value={requirement.id}>
                  {requirement.businessId}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      ) : null}

      <div className="pick-bar">
        <span className="pick-bar-count">
          {selected.size} case{selected.size === 1 ? "" : "s"} selected
          {/* The selection outlives the filter and survives a collapsed group, so it can
              exceed what is on screen. Saying how many are off-screen is what makes the
              count trustworthy — otherwise "12 selected" over four visible ticks reads
              as a bug. */}
          {hiddenSelected.length > 0 ? ` (${hiddenSelected.length} not shown)` : ""}
        </span>
        {/* The way back to an off-screen selection. Without this the only record of what
            was picked is a number, and a review before committing is impossible once the
            filter has moved on. */}
        {selected.size > 0 ? (
          <button
            type="button"
            className={onlySelected ? "btn btn-sm" : "btn btn-secondary btn-sm"}
            onClick={() => setOnlySelected((prev) => !prev)}
            aria-pressed={onlySelected}
            disabled={disabled}
          >
            Only selected
          </button>
        ) : null}
        {/* There is no "expand all": opening everything rebuilds the flat list this
            grouping exists to replace, and hands the reader a capped one at that. The
            way back from five opened groups is what earns a control. */}
        {anyOpen ? (
          <button type="button" className="btn btn-secondary btn-sm" onClick={collapseAll} disabled={disabled}>
            Collapse all
          </button>
        ) : null}
        {selected.size > 0 ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => onSelectedChange(new Set())}
            disabled={disabled}
          >
            Clear selection
          </button>
        ) : null}
      </div>

      {/* The list scrolls inside its own frame rather than growing the page. At the render
          cap this is the difference between a control and three thousand pixels of
          checkboxes with the submit button somewhere past the bottom. */}
      {/* The picker is the control that gets rejected, so it is what carries the
          association to the message — this was the one rejected field in the app whose
          notice was linked to nothing. */}
      <div
        className="pick-list"
        aria-invalid={invalid ? true : undefined}
        aria-describedby={invalid ? describedBy : undefined}
      >
        {grouping.groups.length === 0 ? (
          <div className="empty">
            {/* Several different nothings, and confusing them wastes the reader's time: an
                empty selection, a scope that excludes the selection, a product/requirement
                scope with no match, and a needle that matches nothing at all. Each names
                the filter that actually emptied the list. */}
            {onlySelected && selected.size === 0 ? (
              <p>Nothing is selected yet.</p>
            ) : onlySelected ? (
              <p>
                {selected.size === 1
                  ? "The selected case is not in"
                  : `None of the ${selected.size} selected cases are in`}{" "}
                this scope.
              </p>
            ) : needle !== "" ? (
              <p>
                Nothing matches &ldquo;{needle}&rdquo;
                {scopeLabel ? ` in ${scopeLabel}` : ""}.
              </p>
            ) : (
              <p>{scopeLabel || "This scope"} has no approved cases.</p>
            )}
            {filtering ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={showAll}>
                Show all approved cases
              </button>
            ) : null}
          </div>
        ) : (
          grouping.groups.map((group) => {
            const all = group.selectedCount === group.matching.length;
            const partial = group.selectedCount > 0 && !all;
            /* The label always states the number the click will actually take, so no
               control in this list can under-select silently — the failure the old global
               "Select all N shown" had once the corpus passed the cap. */
            const scope = filtering ? "matching in" : "in";
            const groupAction = all
              ? `Clear the ${group.matching.length} ${scope} ${group.featureBusinessId}`
              : `Select all ${group.matching.length} ${scope} ${group.featureBusinessId}`;

            return (
              <div className="pick-group" key={group.featureId}>
                <div className="pick-group-head">
                  {/* Checkbox and disclosure are siblings, never one inside the other: a
                      control nested in a button is neither reachable nor announced as
                      itself. */}
                  <input
                    type="checkbox"
                    checked={all}
                    aria-label={groupAction}
                    title={groupAction}
                    ref={(node) => {
                      // React has no prop for the third state, and an unchecked box over a
                      // part-selected feature reads as "none of these".
                      //
                      // This must stay an inline arrow. A fresh function each render is
                      // what makes React detach and reattach the ref, which is the only
                      // thing that re-runs this line when `partial` changes — memoize it
                      // and the third state silently freezes at its first value.
                      if (node) node.indeterminate = partial;
                    }}
                    onChange={() => toggleGroupSelection(group)}
                    disabled={disabled}
                  />
                  <button
                    type="button"
                    className="pick-group-toggle"
                    aria-expanded={group.open}
                    onClick={() => toggleGroupOpen(group)}
                    disabled={disabled}
                  >
                    <span className="pick-group-name">
                      <span className="bid">{group.featureBusinessId}</span>
                      <span className="pick-title">{group.featureName}</span>
                      <span className="pick-group-module">{group.moduleName}</span>
                    </span>
                    <span className="pick-group-count">
                      {group.selectedCount} of {group.matching.length} selected
                    </span>
                  </button>
                </div>

                {group.open ? (
                  <div className="pick-group-body">
                    {group.rendered.map((testCase) => (
                      <label
                        key={testCase.id}
                        className={selected.has(testCase.id) ? "pick-row pick-row-on" : "pick-row"}
                      >
                        <input
                          type="checkbox"
                          name={name}
                          value={testCase.id}
                          checked={selected.has(testCase.id)}
                          onChange={() => toggle(testCase.id)}
                          disabled={disabled}
                        />
                        <span className="pick-body">
                          <span className="pick-head">
                            <span className="bid">{testCase.businessId}</span>
                            <span className="pick-title">{testCase.title}</span>
                          </span>
                          {/* Runs get scoped by area and by priority, so those are what a
                              row has to show. The feature and module are on the group
                              header rather than repeated on every row; the requirement
                              stays because the needle can match it, and a needle match on
                              something invisible reads as broken. */}
                          <span className="pick-meta">
                            <span>{testCase.requirementBusinessId}</span>
                            <span>
                              {testCase.priority || "no"} priority · {testCase.severity || "no"} severity
                            </span>
                            {/* Read-only context, never a filter: a check reports what a
                                spec saw, it is not evidence this case was verified
                                (ADR-0008). Silent when there is none — most cases will
                                have none, and a muted "no automation" on every one of them
                                would be noise the row has no room for. */}
                            {testCase.automation ? (
                              <span className={CHECK_OUTCOME_TONE[testCase.automation.outcome] ?? "state"}>
                                {CHECK_OUTCOME_LABEL[testCase.automation.outcome] ?? testCase.automation.outcome}{" "}
                                (last of {testCase.automation.count})
                              </span>
                            ) : null}
                          </span>
                        </span>
                      </label>
                    ))}
                    {/* A truncated group says so. Silence here would read as a complete
                        feature, and the reader would act against cases they never saw.

                        An open group with NOTHING rendered is a different sentence: the
                        budget was spent by the groups above it, and "showing 0 of 8" would
                        read as a feature that has no cases rather than one there was no
                        room for. */}
                    {group.rendered.length === 0 ? (
                      <p className="pick-group-note">
                        No room left to show {group.featureBusinessId}&rsquo;s{" "}
                        {group.matching.length} case{group.matching.length === 1 ? "" : "s"} — the
                        list is capped at {RENDER_LIMIT} rows. Collapse a feature above to make
                        room.
                      </p>
                    ) : group.rendered.length < group.matching.length ? (
                      <p className="pick-group-note">
                        Showing {group.rendered.length} of {group.matching.length} in{" "}
                        {group.featureBusinessId} — the list is capped at {RENDER_LIMIT} rows.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      {/* Counted over the OPEN groups only. `matchingCount` includes every collapsed group,
          and blaming the cap for cases that are merely put away would send a reader to
          narrow a filter that was never the reason they are missing. */}
      {capReached ? (
        <p className="hint" style={{ margin: 0 }}>
          {grouping.renderedCount} of the {grouping.openMatchingCount} cases in the open features
          are on screen — collapse a feature or narrow the filter to reach the rest. Anything
          already selected still submits.
        </p>
      ) : null}

      {/* Cases selected but without a checkbox on screen — filtered out, inside a collapsed
          group, or past the render cap — still submit. Nothing that narrows the list may
          narrow what the caller receives. */}
      {hiddenSelected.map((id) => (
        <input key={id} type="hidden" name={name} value={id} />
      ))}
    </>
  );
}
