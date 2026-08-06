"use client";

import { useActionState, useMemo, useState } from "react";
import { FormNotice } from "@/ui/notice";
import type { FormState } from "@/ui/action";
import { FilterToolbar } from "@/ui/toolbar";
import { fieldClass, fieldProps, noticeId } from "@/ui/form";
import { createExecutionAction } from "./actions";

const FORM_ID = "plan-execution";

/**
 * How many candidate rows are put in the DOM at once. The approved corpus is unbounded
 * — it is every Approved case in the system — and a checkbox per case stops being a
 * picker somewhere in the hundreds: the browser lays out every row, and a list nobody
 * can read to the end of is not a list anyone chooses from. Past this, the filter is
 * the way through, and the count below says so rather than the list just ending.
 */
const RENDER_LIMIT = 100;

export type PlanCandidate = {
  id: string;
  businessId: string;
  title: string;
  priority: string;
  severity: string;
  productId: string;
  requirementId: string;
  requirementBusinessId: string;
  moduleName: string;
  featureName: string;
};

export type PlanProduct = { id: string; businessId: string; name: string };

export type PlanTester = {
  id: string;
  displayName: string;
  /** Unfinished runs already assigned to this person. */
  openRuns: number;
};

/**
 * Everything about a candidate the filter can match. Built from the same fields the row
 * displays, deliberately: a needle that matches something invisible looks broken, and a
 * visible field the needle ignores looks broken in the other direction.
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

/**
 * Planning is a small decision: which approved cases, who runs them. The execution ID
 * is allocated by the server (`docs/business-rules-and-validation.md:11`), so nobody
 * types one. One execution may cover one or more Approved cases selected together
 * (`docs/business-rules-and-validation.md:27`); results are recorded per case at
 * finalize. Only Approved cases are offered because only they can be executed
 * (`docs/data-model.md:47`) — and the domain re-checks that whichever caller asks.
 *
 * ## The selection is the thing this screen must not lose
 *
 * Two mechanisms narrow what is on screen — the filter, and the cap on rendered rows —
 * and NEITHER may narrow what is submitted. A case selected but not currently rendered
 * travels as a hidden input, the count says how many are off screen, and "Only selected"
 * makes them visible again. A run that quietly covers less than the person planning it
 * believed is a mistake they would not discover until finalize.
 *
 * Nothing here validates. Non-empty and no-duplicates are enforced in `createExecution`;
 * a disabled submit is a courtesy.
 */
export function PlanForm({
  cases,
  testers,
  products = [],
  preselect = [],
  unavailable = 0
}: {
  cases: PlanCandidate[];
  testers: PlanTester[];
  /** Products that actually have an Approved case; omit to leave the filter off. */
  products?: PlanProduct[];
  /** Case ids to start selected — a rerun arriving from a finalized run. */
  preselect?: string[];
  /** Requested cases that are no longer offerable, reported rather than dropped. */
  unavailable?: number;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(createExecutionAction, null);
  const [query, setQuery] = useState("");
  const [productId, setProductId] = useState("");
  const [requirementId, setRequirementId] = useState("");
  const [onlySelected, setOnlySelected] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(preselect));
  const bad = (field: string) => fieldClass(state, field);

  /*
   * Requirement options come from the candidates themselves, not a separate catalogue
   * fetch — every case already carries its own requirement, so there is nothing a
   * server round-trip would add. Scoped to the current product (or the whole set, with
   * none chosen) for the same reason `page.tsx` only offers products with a candidate
   * behind them: an option that empties the list on selection reads as a broken filter.
   */
  const requirementOptions = useMemo(() => {
    const scoped = productId === "" ? cases : cases.filter((testCase) => testCase.productId === productId);
    const byId = new Map<string, string>();
    for (const testCase of scoped) byId.set(testCase.requirementId, testCase.requirementBusinessId);
    return [...byId.entries()]
      .map(([id, businessId]) => ({ id, businessId }))
      .sort((a, b) => a.businessId.localeCompare(b.businessId));
  }, [cases, productId]);

  const matching = useMemo(() => {
    let pool = onlySelected ? cases.filter((testCase) => selected.has(testCase.id)) : cases;
    // Product first: it is the broadest cut. Requirement narrows within whatever the
    // product left — its own options are scoped the same way — and the needle
    // searches within whatever both leave, rather than across the whole catalogue.
    if (productId !== "") pool = pool.filter((testCase) => testCase.productId === productId);
    if (requirementId !== "") pool = pool.filter((testCase) => testCase.requirementId === requirementId);
    const needle = query.trim().toLowerCase();
    if (!needle) return pool;
    return pool.filter((testCase) => haystack(testCase).includes(needle));
  }, [cases, query, productId, requirementId, onlySelected, selected]);

  // What is actually rendered. Everything below keys off THIS, not `matching` — a
  // hidden input is what keeps an off-screen selection in the submitted body, so the
  // set of on-screen ids has to be the set with real checkboxes in it.
  const visible = useMemo(() => matching.slice(0, RENDER_LIMIT), [matching]);
  const withheld = matching.length - visible.length;

  const visibleIds = useMemo(() => new Set(visible.map((testCase) => testCase.id)), [visible]);
  const allVisibleSelected = visible.length > 0 && visible.every((testCase) => selected.has(testCase.id));
  const hiddenSelected = [...selected].filter((id) => !visibleIds.has(id));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAllVisible = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const testCase of visible) {
        if (allVisibleSelected) next.delete(testCase.id);
        else next.add(testCase.id);
      }
      return next;
    });

  const showAll = () => {
    setOnlySelected(false);
    setQuery("");
    setProductId("");
    setRequirementId("");
  };

  const productName = products.find((product) => product.id === productId)?.name;
  const requirementName = requirementOptions.find((requirement) => requirement.id === requirementId)?.businessId;
  const scopeLabel = [productName, requirementName].filter(Boolean).join(" · ");

  /*
   * A needle earns its place once the list is long enough to be worth narrowing; the
   * product and requirement dropdowns earn theirs as soon as there is anything to
   * offer, regardless of how many candidates are on screen. Different questions, so
   * different conditions — and every option offered always has a candidate behind it
   * (`page.tsx` for products; `requirementOptions` is built the same way).
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
                  value={query}
                  onChange={setQuery}
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
                    // The requirement options are about to be rescoped to the new
                    // product; a selection from the old scope could now point at a
                    // requirement no other row shares, which would look like a
                    // second, unexplained filter narrowing the list.
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
              {/* The selection outlives the filter, so it can exceed what is on screen.
                  Saying how many are off-screen is what makes the count trustworthy —
                  otherwise "12 selected" over four visible ticks reads as a bug. */}
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
            {visible.length > 0 ? (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={toggleAllVisible}
                disabled={pending}
              >
                {allVisibleSelected
                  ? `Clear the ${visible.length} shown`
                  : `Select all ${visible.length} shown`}
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
            {visible.length === 0 ? (
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
                ) : query !== "" ? (
                  <p>
                    Nothing matches &ldquo;{query}&rdquo;
                    {scopeLabel ? ` in ${scopeLabel}` : ""}.
                  </p>
                ) : (
                  <p>{scopeLabel || "This scope"} has no approved cases to plan.</p>
                )}
                {onlySelected || query !== "" || productId !== "" || requirementId !== "" ? (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={showAll}>
                    Show all approved cases
                  </button>
                ) : null}
              </div>
            ) : (
              visible.map((testCase) => (
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
                    {/* Runs get scoped by area and by priority, so those are what a row
                        has to show — as two separate chunks, because they answer two
                        different questions. Module, feature, and requirement come from
                        the hierarchy: the business ID encodes only the product. The
                        requirement is shown because the needle can match it — a needle
                        match on something invisible would read as broken. */}
                    <span className="pick-meta">
                      <span>
                        {testCase.moduleName} · {testCase.featureName} · {testCase.requirementBusinessId}
                      </span>
                      <span>
                        {testCase.priority || "no"} priority · {testCase.severity || "no"} severity
                      </span>
                    </span>
                  </span>
                </label>
              ))
            )}
          </div>

          {withheld > 0 ? (
            <p className="hint" style={{ margin: 0 }}>
              Showing the first {visible.length} of {matching.length} approved cases — narrow the
              filter to reach the rest. Anything already selected still submits.
            </p>
          ) : null}

          {/* Cases selected but not on screen — filtered out, or past the render limit —
              still submit. Neither narrowing nor capping the list drops a choice. */}
          {hiddenSelected.map((id) => (
            <input key={id} type="hidden" name="testCaseIds" value={id} />
          ))}

          <span className="hint">
            Select one or more — the run covers them together, and each gets its own result at
            finalize. The execution ID is assigned automatically.
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
