"use client";

import { useActionState } from "react";
import { FormNotice } from "@/ui/notice";
import type { FormState } from "@/ui/action";
import { fieldClass, fieldProps, noticeId } from "@/ui/form";
import { createDefectAction } from "../actions";

const FORM_ID = "new-defect";

/**
 * Any role with defect-edit permission may raise a New defect
 * (`roles-workflows.md:51`). Priority and severity can wait — they are required
 * before triage, not to report the problem.
 */
export function NewDefectForm({
  cases,
  priorities,
  severities
}: {
  cases: Array<{ id: string; businessId: string; title: string }>;
  priorities: string[];
  severities: string[];
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(createDefectAction, null);
  const bad = (field: string) => fieldClass(state, field);

  return (
    <form action={formAction}>
      <FormNotice state={state} id={noticeId(FORM_ID)} />

      <label className={bad("businessId")}>
        <span>Defect ID</span>
        <input name="businessId" placeholder="BUG-0001" required disabled={pending} {...fieldProps(state, "businessId", FORM_ID)} />
      </label>

      <label className={bad("testCaseId")}>
        <span>Test case</span>
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

      <label className={bad("summary")}>
        <span>Summary</span>
        <textarea name="summary" rows={2} required disabled={pending} {...fieldProps(state, "summary", FORM_ID)} />
      </label>

      <div className="form-grid-2">
        <label className={bad("priority")}>
          <span>Priority</span>
          <select name="priority" defaultValue="" disabled={pending} {...fieldProps(state, "priority", FORM_ID)}>
            <option value="">Not set yet</option>
            {priorities.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className={bad("severity")}>
          <span>Severity</span>
          <select name="severity" defaultValue="" disabled={pending} {...fieldProps(state, "severity", FORM_ID)}>
            <option value="">Not set yet</option>
            {severities.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>

      <button className="btn" type="submit" disabled={pending}>
        {pending ? "Raising…" : "Raise defect"}
      </button>
    </form>
  );
}
