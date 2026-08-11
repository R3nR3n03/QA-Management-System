"use client";

import { useActionState, useMemo, useState } from "react";
import { FormNotice } from "@/ui/notice";
import type { FormState } from "@/ui/action";
import { FilterToolbar } from "@/ui/toolbar";
import { fieldClass, fieldProps, noticeId } from "@/ui/form";
import { EXECUTION_PURPOSE_MAX_LENGTH } from "@/lib/field-limits";
import {
  dropExplicitCloses,
  groupCandidates,
  isFiltering,
  RENDER_LIMIT,
  type PlanCandidate,
  type PlanGroup
} from "@/ui/plan-grouping";
import { createExecutionAction } from "./actions";

const FORM_ID = "plan-execution";

export type PlanProduct = { id: string; businessId: string; name: string };

export type PlanTester = {
  id: string;
  displayName: string;
  /** Unfinished runs already assigned to this person. */
  openRuns: number;
};

/**
 * Planning is a small decision: which approved cases, who runs them. The execution ID
 * is allocated by the server (`docs/business-rules-and-validation.md:11`), so nobody
 * types one. One execution may cover one or more Approved cases selected together
 * (`docs/business-rules-and-validation.md:27`); results are recorded per case at
 * finalize. Only Approved cases are offered because only they can be executed
 * (`docs/data-model.md:47`) — and the domain re-checks that whichever caller asks.
 *
 * ## Cases are grouped by feature, not listed flat
 *
 * The corpus is every Approved case in the system, and a flat list of it makes a planner
 * read hundreds of rows to assemble a run they think of in features. So the picker shows
 * one collapsed group per feature and lets a whole feature be taken in one click. The
 * grouping, filtering, open/closed and render-cap rules all live in
 * `src/ui/plan-grouping.ts`, which is where their combinations are tested; this file
 * renders what that returns.
 *
 * ## The selection is the thing this screen must not lose
 *
 * Three things now narrow what is on screen — the filters, the collapsed groups, and the
 * cap on rendered rows — and NONE of them may narrow what is submitted. A case selected
 * but not currently rendered travels as a hidden input, the count says how many are off
 * screen, and "Only selected" makes them visible again. A run that quietly covers less
 * than the person planning it believed is a mistake they would not discover until finalize.
 *
 * Nothing here validates. Non-empty and no-duplicates are enforced in `createExecution`;
 * a disabled submit is a courtesy.
 */
export function PlanForm({
  cases,
  testers,
  products = [],
  preselect = [],
  unavailable = 0,
  defaultPurpose = ""
}: {
  cases: PlanCandidate[];
  testers: PlanTester[];
  /** Products that actually have an Approved case; omit to leave the filter off. */
  products?: PlanProduct[];
  /** Case ids to start selected — a rerun arriving from a finalized run. */
  preselect?: string[];
  /** Requested cases that are no longer offerable, reported rather than dropped. */
  unavailable?: number;
  /**
   * The source run's purpose when this is a rerun, so the planner edits a sentence rather
   * than writing one. A preselection like `preselect`, never an instruction: it is a plain
   * `defaultValue`, so typing over it is the whole of the escape hatch.
   */
  defaultPurpose?: string;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(createExecutionAction, null);
  const [needle, setNeedle] = useState("");
  const [productId, setProductId] = useState("");
  const [requirementId, setRequirementId] = useState("");
  const [onlySelected, setOnlySelected] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(preselect));
  /**
   * The reader's explicit open/closed choices, by feature id. Absent means "follow the
   * automatic rules" — which is not the same as closed, and is why this is a Map of choices
   * rather than a Set of open ids: a group holding a selection is open until someone closes
   * it, and only an explicit `false` can express that.
   */
  const [openOverride, setOpenOverride] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const bad = (field: string) => fieldClass(state, field);

  /*
   * Requirement options come from the candidates themselves, not a separate catalogue fetch
   * — every case already carries its own hierarchy, so there is nothing a server round-trip
   * would add. Scoped to whatever the product left, for the same reason `page.tsx` only
   * offers products with a candidate behind them: an option that empties the list on
   * selection reads as a broken filter.
   *
   * There is no feature dropdown any more. The groups ARE the features, and two controls
   * doing one job make a reader hunt for a difference that is not there.
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

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

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
  const toggleGroupSelection = (group: PlanGroup) =>
    setSelected((prev) => {
      const next = new Set(prev);
      const all = group.selectedCount === group.matching.length;
      for (const one of group.matching) {
        if (all) next.delete(one.id);
        else next.add(one.id);
      }
      return next;
    });

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
   * conditions — and every option offered always has a candidate behind it (`page.tsx` for
   * products; `requirementOptions` is built the same way).
   */
  const showNeedle = cases.length > 5;
  const showProducts = products.length > 0;
  const showRequirements = requirementOptions.length > 0;

  return (
    <form action={formAction}>
      <FormNotice state={state} id={noticeId(FORM_ID)} />

      {unavailable > 0 ? (
        <div className="notice notice-advisory" role="status">
          <strong>
            {unavailable} case{unavailable === 1 ? "" : "s"} could not be carried over
          </strong>
          <span>
            {unavailable === 1 ? "It is" : "They are"} no longer Approved — a revised or retired
            case cannot be executed. Everything else from that run is selected below.
          </span>
        </div>
      ) : null}

      {/*
        First, because it is the question the rest of the form answers the details of: what
        is this run for, then which cases, then who. It is also the field every row of
        `/executions` and `/my-work` is headed with, so it is not an afterthought at the
        bottom. `maxLength` stops the typing at the documented cap rather than letting
        someone write a paragraph and lose it on submit — the rule itself is the domain's,
        which refuses a blank or over-long purpose with 422 ID_INVALID.
      */}
      <label className={bad("purpose")}>
        <span>Purpose</span>
        <input
          name="purpose"
          type="text"
          required
          maxLength={EXECUTION_PURPOSE_MAX_LENGTH}
          defaultValue={defaultPurpose}
          placeholder="Sprint 24 regression, Chrome"
          autoComplete="off"
          disabled={pending}
          {...fieldProps(state, "purpose", FORM_ID)}
        />
        <span className="hint">
          One line saying what this run checks. It is what the run is listed under in the
          executions list and in the tester&rsquo;s queue, so make it tell them apart —
          &ldquo;Sprint 24 regression, Chrome&rdquo;, not &ldquo;Run 3&rdquo;.
        </span>
      </label>

      {/*
        A rejected GROUP marks the section, not the controls inside it. `bad()` returns
        the FIELD classes — meant for a `<label className="field">` — and on a fieldset
        `.field select { width: 100% }` stretched the product filter while
        `.field-bad select { border-color: var(--fail) }` turned it red. So rejecting
        the case selection pointed the error at a dropdown that had nothing to do with
        it. `outcome-set-bad` in FinalizeForm is the same pattern done correctly.
      */}
      <fieldset className={`form-section${state?.field === "testCaseIds" ? " form-section-bad" : ""}`}>
        <legend>Approved test cases</legend>
        <div className="stack">
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
              {/* Products are catalogue records with no ceiling, so a dropdown rather
                  than a chip row. Local state, not the URL: everything this form filters
                  is already in the browser, and a navigation would discard the
                  selection built up so far. */}
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
                  disabled={pending}
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
                  disabled={pending}
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
            {/* The way back to an off-screen selection. Without this the only record of
                what was picked is a number, and a review before committing is impossible
                once the filter has moved on. */}
            {selected.size > 0 ? (
              <button
                type="button"
                className={onlySelected ? "btn btn-sm" : "btn btn-secondary btn-sm"}
                onClick={() => setOnlySelected((prev) => !prev)}
                aria-pressed={onlySelected}
                disabled={pending}
              >
                Only selected
              </button>
            ) : null}
            {/* There is no "expand all": opening everything rebuilds the flat list this
                grouping exists to replace, and hands the reader a capped one at that. The
                way back from five opened groups is what earns a control. */}
            {anyOpen ? (
              <button type="button" className="btn btn-secondary btn-sm" onClick={collapseAll} disabled={pending}>
                Collapse all
              </button>
            ) : null}
            {selected.size > 0 ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setSelected(new Set())}
                disabled={pending}
              >
                Clear selection
              </button>
            ) : null}
          </div>

          {/* The list scrolls inside its own frame rather than growing the page. At the
              render cap this is the difference between a control and three thousand
              pixels of checkboxes with the submit button somewhere past the bottom. */}
          {/* The picker is the control that was rejected, so it is what carries the
              association to the message — `testCaseIds` was the one rejected field in
              the app whose notice was linked to nothing. */}
          <div
            className="pick-list"
            aria-invalid={state?.field === "testCaseIds" ? true : undefined}
            aria-describedby={state?.field === "testCaseIds" ? noticeId(FORM_ID) : undefined}
          >
            {grouping.groups.length === 0 ? (
              <div className="empty">
                {/* Several different nothings, and confusing them wastes the reader's
                    time: an empty selection, a scope that excludes the selection, a
                    product/requirement scope with no match, and a needle that matches
                    nothing at all. Each names the filter that actually emptied the list. */}
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
                  <p>{scopeLabel || "This scope"} has no approved cases to plan.</p>
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
                   control in this list can under-select silently — the failure the old
                   global "Select all N shown" had once the corpus passed the cap. */
                const scope = filtering ? "matching in" : "in";
                const groupAction = all
                  ? `Clear the ${group.matching.length} ${scope} ${group.featureBusinessId}`
                  : `Select all ${group.matching.length} ${scope} ${group.featureBusinessId}`;

                return (
                  <div className="pick-group" key={group.featureId}>
                    <div className="pick-group-head">
                      {/* Checkbox and disclosure are siblings, never one inside the other:
                          a control nested in a button is neither reachable nor announced
                          as itself. */}
                      <input
                        type="checkbox"
                        checked={all}
                        aria-label={groupAction}
                        title={groupAction}
                        ref={(node) => {
                          // React has no prop for the third state, and an unchecked box
                          // over a part-selected feature reads as "none of these".
                          //
                          // This must stay an inline arrow. A fresh function each render is
                          // what makes React detach and reattach the ref, which is the only
                          // thing that re-runs this line when `partial` changes — memoize it
                          // and the third state silently freezes at its first value.
                          if (node) node.indeterminate = partial;
                        }}
                        onChange={() => toggleGroupSelection(group)}
                        disabled={pending}
                      />
                      <button
                        type="button"
                        className="pick-group-toggle"
                        aria-expanded={group.open}
                        onClick={() => toggleGroupOpen(group)}
                        disabled={pending}
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
                              name="testCaseIds"
                              value={testCase.id}
                              checked={selected.has(testCase.id)}
                              onChange={() => toggle(testCase.id)}
                              disabled={pending}
                            />
                            <span className="pick-body">
                              <span className="pick-head">
                                <span className="bid">{testCase.businessId}</span>
                                <span className="pick-title">{testCase.title}</span>
                              </span>
                              {/* Runs get scoped by area and by priority, so those are what
                                  a row has to show. The feature and module are on the group
                                  header rather than repeated on every row; the requirement
                                  stays because the needle can match it, and a needle match
                                  on something invisible reads as broken. */}
                              <span className="pick-meta">
                                <span>{testCase.requirementBusinessId}</span>
                                <span>
                                  {testCase.priority || "no"} priority · {testCase.severity || "no"} severity
                                </span>
                              </span>
                            </span>
                          </label>
                        ))}
                        {/* A truncated group says so. Silence here would read as a complete
                            feature, and the reader would plan against cases they never saw.

                            An open group with NOTHING rendered is a different sentence: the
                            budget was spent by the groups above it, and "showing 0 of 8" would
                            read as a feature that has no cases rather than one there was no
                            room for. */}
                        {group.rendered.length === 0 ? (
                          <p className="pick-group-note">
                            No room left to show {group.featureBusinessId}&rsquo;s{" "}
                            {group.matching.length} case{group.matching.length === 1 ? "" : "s"} —
                            the list is capped at {RENDER_LIMIT} rows. Collapse a feature above to
                            make room.
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

          {/* Counted over the OPEN groups only. `matchingCount` includes every collapsed
              group, and blaming the cap for cases that are merely put away would send a reader
              to narrow a filter that was never the reason they are missing. */}
          {capReached ? (
            <p className="hint" style={{ margin: 0 }}>
              {grouping.renderedCount} of the {grouping.openMatchingCount} cases in the open
              features are on screen — collapse a feature or narrow the filter to reach the rest.
              Anything already selected still submits.
            </p>
          ) : null}

          {/* Cases selected but without a checkbox on screen — filtered out, inside a
              collapsed group, or past the render cap — still submit. Nothing that narrows
              the list may narrow the run. */}
          {hiddenSelected.map((id) => (
            <input key={id} type="hidden" name="testCaseIds" value={id} />
          ))}

          <span className="hint">
            Open a feature to pick cases, or tick the feature to take all of them. The run covers
            them together, and each gets its own result at finalize. The execution ID is assigned
            automatically.
          </span>
        </div>
      </fieldset>

      <label className={bad("testerId")}>
        <span>Assigned tester</span>
        <select name="testerId" required defaultValue="" disabled={pending} {...fieldProps(state, "testerId", FORM_ID)}>
          <option value="" disabled>
            Choose…
          </option>
          {testers.map((tester) => (
            <option key={tester.id} value={tester.id}>
              {tester.displayName} · {tester.openRuns} open
            </option>
          ))}
        </select>
        <span className="hint">
          The run appears in their work queue; only they (or a higher role) can start it. The
          count is how many unfinished runs each person already has — a workload, not a limit.
        </span>
      </label>

      {/*
        Optional, and the only point at which it can be set: the key is part of the record
        once the run leaves Planned, the same rule that freezes the tester
        (`docs/roles-workflows.md`). Not `type="url"` or a pattern attribute — the format is
        a documented business rule and belongs to the domain, which refuses a malformed key
        with 422 ID_INVALID and reports it through this form's notice like every other rule.
      */}
      <label className={bad("jiraIssueKey")}>
        <span>Jira issue key (optional)</span>
        <input
          name="jiraIssueKey"
          type="text"
          placeholder="PROJ-123"
          autoComplete="off"
          disabled={pending}
          {...fieldProps(state, "jiraIssueKey", FORM_ID)}
        />
        <span className="hint">
          The Jira task this run tests. When every run against the same key is finalized and
          all of them pass, QAMS moves that issue to Done. Leave it blank if this run has no
          Jira task — a failed or blocked run never moves the issue.
        </span>
      </label>

      <button className="btn" type="submit" disabled={pending || selected.size === 0}>
        {pending
          ? "Planning…"
          : selected.size === 0
            ? "Plan execution"
            : `Plan execution covering ${selected.size} case${selected.size === 1 ? "" : "s"}`}
      </button>
      {selected.size === 0 ? (
        <p className="hint" style={{ marginTop: "var(--sp-2)" }}>
          Pick at least one approved case to cover.
        </p>
      ) : null}
    </form>
  );
}
