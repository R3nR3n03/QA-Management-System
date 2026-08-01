"use client";

import { useActionState, useState } from "react";
import { FormNotice } from "@/ui/notice";
import type { FormState } from "@/ui/action";
import { fieldClass, fieldProps, noticeId } from "@/ui/form";
import { createRtmLinkAction } from "./actions";

const FORM_ID = "rtm-link";

/**
 * Linking is constrained twice before the domain sees it: only test cases under the
 * chosen requirement are offered, and only defects against the chosen case. The
 * domain still enforces the 4-level chain (`HIERARCHY_MISMATCH`) — this form just
 * refuses to offer an invalid pair in the first place.
 */
export function LinkForm({
  requirements,
  cases,
  defects
}: {
  requirements: Array<{ id: string; businessId: string; label: string }>;
  cases: Array<{ id: string; businessId: string; title: string; requirementId: string }>;
  defects: Array<{ id: string; businessId: string; summary: string; testCaseId: string }>;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(createRtmLinkAction, null);
  const [requirementId, setRequirementId] = useState("");
  const [testCaseId, setTestCaseId] = useState("");

  const bad = (field: string) => fieldClass(state, field);
  const caseOptions = cases.filter((c) => c.requirementId === requirementId);
  const defectOptions = defects.filter((d) => d.testCaseId === testCaseId);

  return (
    <form action={formAction}>
      <FormNotice state={state} id={noticeId(FORM_ID)} />

      <label className={bad("requirementId")}>
        <span>Requirement</span>
        <select
          name="requirementId"
          required
          value={requirementId}
          onChange={(e) => {
            setRequirementId(e.target.value);
            setTestCaseId("");
          }}
          disabled={pending}
          {...fieldProps(state, "requirementId", FORM_ID)}
        >
          <option value="" disabled>
            Choose…
          </option>
          {requirements.map((r) => (
            <option key={r.id} value={r.id}>
              {r.businessId} · {r.label}
            </option>
          ))}
        </select>
      </label>

      <label className={bad("testCaseId")}>
        <span>Test case</span>
        <select
          name="testCaseId"
          required
          value={testCaseId}
          onChange={(e) => setTestCaseId(e.target.value)}
          disabled={pending || !requirementId}
          {...fieldProps(state, "testCaseId", FORM_ID)}
        >
          <option value="" disabled>
            {requirementId ? "Choose…" : "Pick a requirement first"}
          </option>
          {caseOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.businessId} · {c.title}
            </option>
          ))}
        </select>
        <span className="hint">Only cases written against the chosen requirement are offered.</span>
      </label>

      <label className={bad("defectId")}>
        <span>Defect (optional)</span>
        <select name="defectId" defaultValue="" disabled={pending || !testCaseId} {...fieldProps(state, "defectId", FORM_ID)}>
          <option value="">No defect</option>
          {defectOptions.map((d) => (
            <option key={d.id} value={d.id}>
              {d.businessId} · {d.summary}
            </option>
          ))}
        </select>
      </label>

      <button className="btn" type="submit" disabled={pending}>
        {pending ? "Linking…" : "Create link"}
      </button>
    </form>
  );
}
