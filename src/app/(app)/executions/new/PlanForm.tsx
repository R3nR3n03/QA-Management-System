"use client";

import { useActionState } from "react";
import { FormNotice } from "@/ui/notice";
import type { FormState } from "@/ui/action";
import { fieldClass, fieldProps, noticeId } from "@/ui/form";
import { createExecutionAction } from "./actions";

const FORM_ID = "plan-execution";

/**
 * Planning is a small decision: which approved case, who runs it, under what ID.
 * Only Approved cases are offered because only they can be executed
 * (`docs/data-model.md:46`) — and the domain re-checks that whichever caller asks.
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

      <label className={bad("testCaseId")}>
        <span>Approved test case</span>
        <select name="testCaseId" required defaultValue="" disabled={pending} {...fieldProps(state, "testCaseId", FORM_ID)}>
          <option value="" disabled>
            Choose…
          </option>
          {cases.map((testCase) => (
            <option key={testCase.id} value={testCase.id}>
              {testCase.businessId} · {testCase.title}
            </option>
          ))}
        </select>
      </label>

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
