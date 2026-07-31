"use client";

import { useActionState } from "react";
import { FormNotice } from "@/ui/notice";
import type { FormState } from "@/ui/action";
import { createDefectAction } from "../actions";

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
  const bad = (field: string) => (state?.field === field ? "field field-bad" : "field");

  return (
    <form action={formAction}>
      <FormNotice state={state} />

      <label className={bad("businessId")}>
        <span>Defect ID</span>
        <input name="businessId" placeholder="BUG-0001" required disabled={pending} />
      </label>

      <label className={bad("testCaseId")}>
        <span>Test case</span>
        <select name="testCaseId" required defaultValue="" disabled={pending}>
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
        <textarea name="summary" rows={2} required disabled={pending} />
      </label>

      <div style={{ display: "flex", gap: "var(--sp-3)" }}>
        <label className={bad("priority")} style={{ flex: 1 }}>
          <span>Priority</span>
          <select name="priority" defaultValue="" disabled={pending}>
            <option value="">Not set yet</option>
            {priorities.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className={bad("severity")} style={{ flex: 1 }}>
          <span>Severity</span>
          <select name="severity" defaultValue="" disabled={pending}>
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
