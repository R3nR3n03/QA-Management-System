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

/**
 * Planning is a small decision: which approved cases, who runs them. The execution ID
 * is allocated by the server (`docs/business-rules-and-validation.md:11`), so nobody
 * types one. One execution may cover one or more Approved cases selected together
 * (`docs/business-rules-and-validation.md:27`); results are recorded per case at
 * finalize. Only Approved cases are offered because only they can be executed
 * (`docs/data-model.md:47`) — and the domain re-checks that whichever caller asks.
 *
 * The search only filters what is SHOWN; the selection survives filtering. Cases that
 * are selected but not currently on screen — filtered out, or past the render limit —
 * submit through hidden inputs, so neither narrowing the list nor capping it can
 * silently drop a choice.
 */
export function PlanForm({
  cases,
  testers,
  preselect = [],
  unavailable = 0
}: {
  cases: Array<{ id: string; businessId: string; title: string }>;
  testers: Array<{ id: string; displayName: string }>;
  /** Case ids to start selected — a rerun arriving from a finalized run. */
  preselect?: string[];
  /** Requested cases that are no longer offerable, reported rather than dropped. */
  unavailable?: number;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(createExecutionAction, null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(preselect));
  const bad = (field: string) => fieldClass(state, field);

  const matching = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return cases;
    return cases.filter((testCase) =>
      `${testCase.businessId} ${testCase.title}`.toLowerCase().includes(needle)
    );
  }, [cases, query]);

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

      <fieldset className={`form-section ${bad("testCaseIds")}`}>
        <legend>Approved test cases</legend>
        <div className="stack">
          {cases.length > 5 ? (
            <FilterToolbar
              value={query}
              onChange={setQuery}
              placeholder="Filter by ID or title…"
              label="Filter approved test cases"
            />
          ) : null}

          <div className="row">
            <span className="muted">
              {selected.size} case{selected.size === 1 ? "" : "s"} selected
              {/* The selection outlives the filter, so it can exceed what is on screen.
                  Saying how many are off-screen is what makes the count trustworthy —
                  otherwise "12 selected" over four visible ticks reads as a bug. */}
              {hiddenSelected.length > 0 ? ` (${hiddenSelected.length} not shown)` : ""}
            </span>
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

          {visible.length === 0 ? (
            <div className="empty">
              <p>Nothing matches &ldquo;{query}&rdquo;.</p>
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
                <span>
                  <span className="bid">{testCase.businessId}</span> {testCase.title}
                </span>
              </label>
            ))
          )}

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
              {tester.displayName}
            </option>
          ))}
        </select>
        <span className="hint">The run appears in their work queue; only they (or a higher role) can start it.</span>
      </label>

      <button className="btn" type="submit" disabled={pending}>
        {pending ? "Planning…" : "Plan execution"}
      </button>
    </form>
  );
}
