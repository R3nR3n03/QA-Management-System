"use client";

import { useActionState } from "react";
import { FormNotice } from "@/ui/notice";
import type { FormState } from "@/ui/action";
import { transitionDefectAction, updateDefectAction } from "../actions";

/**
 * The defect forms. Only the transitions valid from the current status render, each
 * asking exactly for what the documented condition requires
 * (`docs/roles-workflows.md:43-49`) — and the domain re-checks all of it.
 */

export function DefectEditForm({
  defect,
  priorities,
  severities
}: {
  defect: { id: string; version: number; summary: string; priority: string; severity: string };
  priorities: string[];
  severities: string[];
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(updateDefectAction, null);
  const bad = (field: string) => (state?.field === field ? "field field-bad" : "field");

  return (
    <form action={formAction}>
      <input type="hidden" name="defectId" value={defect.id} />
      <input type="hidden" name="version" value={defect.version} />
      <FormNotice state={state} />

      <label className={bad("summary")}>
        <span>Summary</span>
        <textarea name="summary" rows={2} defaultValue={defect.summary} required disabled={pending} />
      </label>
      <div style={{ display: "flex", gap: "var(--sp-3)" }}>
        <label className={bad("priority")} style={{ flex: 1 }}>
          <span>Priority</span>
          <select name="priority" defaultValue={defect.priority} disabled={pending}>
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
          <select name="severity" defaultValue={defect.severity} disabled={pending}>
            <option value="">Not set yet</option>
            {severities.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="muted" style={{ marginBottom: "var(--sp-3)" }}>
        Details are editable only while the defect is New; priority and severity are required before
        triage.
      </p>
      <button className="btn btn-secondary" type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save details"}
      </button>
    </form>
  );
}

export function TransitionForm({
  defect,
  target,
  label,
  owners
}: {
  defect: { id: string; version: number };
  target: "TRIAGED" | "IN_PROGRESS" | "RESOLVED" | "CLOSED" | "REOPEN";
  label: string;
  owners?: Array<{ id: string; displayName: string }>;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(transitionDefectAction, null);
  const bad = (field: string) => (state?.field === field ? "field field-bad" : "field");
  const targetStatus = target === "REOPEN" ? "IN_PROGRESS" : target;

  return (
    <form action={formAction} style={{ marginBottom: "var(--sp-4)" }}>
      <input type="hidden" name="defectId" value={defect.id} />
      <input type="hidden" name="version" value={defect.version} />
      <input type="hidden" name="targetStatus" value={targetStatus} />
      <FormNotice state={state} />

      {target === "IN_PROGRESS" && owners ? (
        <label className={bad("investigationOwnerId")}>
          <span>Investigation owner</span>
          <select name="investigationOwnerId" required defaultValue="" disabled={pending}>
            <option value="" disabled>
              Choose…
            </option>
            {owners.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.displayName}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {target === "RESOLVED" ? (
        <label className={bad("resolutionSummary")}>
          <span>Resolution summary</span>
          <textarea name="resolutionSummary" rows={2} required disabled={pending} />
        </label>
      ) : null}

      {target === "CLOSED" ? (
        <>
          <label className={bad("retestEvidenceRef")}>
            <span>Retest evidence reference</span>
            <input name="retestEvidenceRef" disabled={pending} />
            <span className="hint">A reference string only — no file upload in v1.</span>
          </label>
          <label className={bad("closureRationale")}>
            <span>Closure rationale</span>
            <textarea name="closureRationale" rows={2} disabled={pending} />
            <span className="hint">One of the two fields above is required to close.</span>
          </label>
        </>
      ) : null}

      {target === "REOPEN" ? (
        <label className={bad("reopenReason")}>
          <span>Reopen reason</span>
          <textarea name="reopenReason" rows={2} required disabled={pending} />
          <span className="hint">Recorded in the audit trail — it is the answer to &ldquo;why was this reopened&rdquo;.</span>
        </label>
      ) : null}

      <button className="btn" type="submit" disabled={pending}>
        {pending ? "Working…" : label}
      </button>
    </form>
  );
}
