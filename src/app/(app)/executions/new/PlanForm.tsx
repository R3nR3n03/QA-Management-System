"use client";

import { useActionState } from "react";
import { FormNotice } from "@/ui/notice";
import type { FormState } from "@/ui/action";
import { fieldClass, fieldProps, noticeId } from "@/ui/form";
import { createExecutionAction } from "./actions";

const FORM_ID = "plan-execution";

/**
 * Planning is a small decision: which approved cases, who runs them, under what ID.
 * One execution may cover one or more Approved cases selected together
 * (`docs/business-rules-and-validation.md:27`); results are recorded per case at
 * finalize. Only Approved cases are offered because only they can be executed
 * (`docs/data-model.md:47`) — and the domain re-checks that whichever caller asks.
 */
export function PlanForm({
  cases,
  testers
}: {
  cases: Array<{ id: string; businessId: string; title: string }>;
  testers: Array<{ id: string; displayName: string }>;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(createExecutionAction, null);
  const bad = (field: string) => fieldClass(state, field);

  return (
    <form action={formAction}>
      <FormNotice state={state} id={noticeId(FORM_ID)} />

      <label className={bad("businessId")}>
        <span>Execution ID</span>
        <input name="businessId" placeholder="EXE-0001" required disabled={pending} {...fieldProps(state, "businessId", FORM_ID)} />
        <span className="hint">Format EXE-#### — unique across the repository.</span>
      </label>

      <fieldset className={bad("testCaseIds")} style={{ border: 0, margin: 0, padding: 0 }}>
        <legend>
          <span>Approved test cases</span>
        </legend>
        {cases.map((testCase) => (
          <label key={testCase.id} className="row" style={{ padding: "var(--sp-1) 0" }}>
            <input type="checkbox" name="testCaseIds" value={testCase.id} disabled={pending} />
            <span>
              {testCase.businessId} · {testCase.title}
            </span>
          </label>
        ))}
        <span className="hint">
          Select one or more — the run covers them together, and each gets its own result at
          finalize.
        </span>
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
