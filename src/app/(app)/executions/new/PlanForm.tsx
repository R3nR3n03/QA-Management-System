"use client";

import { useActionState, useMemo, useState } from "react";
import { FormNotice } from "@/ui/notice";
import type { FormState } from "@/ui/action";
import { FilterToolbar } from "@/ui/toolbar";
import { fieldClass, fieldProps, noticeId } from "@/ui/form";
import { createExecutionAction } from "./actions";

const FORM_ID = "plan-execution";

/**
 * Planning is a small decision: which approved cases, who runs them. The execution ID
 * is allocated by the server (`docs/business-rules-and-validation.md:11`), so nobody
 * types one. One execution may cover one or more Approved cases selected together
 * (`docs/business-rules-and-validation.md:27`); results are recorded per case at
 * finalize. Only Approved cases are offered because only they can be executed
 * (`docs/data-model.md:47`) — and the domain re-checks that whichever caller asks.
 *
 * The search only filters what is SHOWN; the selection survives filtering. Cases that
 * are selected but currently filtered out submit through hidden inputs, so narrowing
 * the list can never silently drop a choice.
 */
export function PlanForm({
  cases,
  testers
}: {
  cases: Array<{ id: string; businessId: string; title: string }>;
  testers: Array<{ id: string; displayName: string }>;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(createExecutionAction, null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const bad = (field: string) => fieldClass(state, field);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return cases;
    return cases.filter((testCase) =>
      `${testCase.businessId} ${testCase.title}`.toLowerCase().includes(needle)
    );
  }, [cases, query]);

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
          </div>

          {visible.length === 0 ? (
            <div className="empty">
              <p>Nothing matches &ldquo;{query}&rdquo;.</p>
            </div>
          ) : (
            visible.map((testCase) => (
              <label key={testCase.id} className="row">
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

          {/* Selected-but-filtered cases still submit — filtering never drops a choice. */}
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
