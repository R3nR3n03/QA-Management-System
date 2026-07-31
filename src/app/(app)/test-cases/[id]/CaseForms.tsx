"use client";

import { useActionState, useState } from "react";
import { FormNotice } from "@/ui/notice";
import type { FormState } from "@/ui/action";
import {
  approveTestCaseAction,
  replaceStepsAction,
  retireTestCaseAction,
  returnToDraftAction,
  submitTestCaseAction,
  updateDraftAction
} from "../actions";

/**
 * The lifecycle forms for one test case. Which of these render is the page's
 * presentation choice; whether they succeed is decided in `src/domain/test-cases.ts`
 * — a submit with JavaScript disabled hits the same checks and gets the same copy.
 */

type CaseFields = {
  id: string;
  version: number;
  cycle: string;
  sprint: string;
  release: string;
  environment: string;
  priority: string;
  severity: string;
  title: string;
  objective: string;
  expectedResult: string;
};

export function DraftEditForm({
  testCase,
  priorities,
  severities
}: {
  testCase: CaseFields;
  priorities: string[];
  severities: string[];
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(updateDraftAction, null);
  const bad = (field: string) => (state?.field === field ? "field field-bad" : "field");

  return (
    <form action={formAction}>
      <input type="hidden" name="testCaseId" value={testCase.id} />
      <input type="hidden" name="version" value={testCase.version} />
      <FormNotice state={state} />

      <label className={bad("title")}>
        <span>Title</span>
        <input name="title" defaultValue={testCase.title} required disabled={pending} />
      </label>
      <label className={bad("objective")}>
        <span>Objective</span>
        <textarea name="objective" rows={2} defaultValue={testCase.objective} required disabled={pending} />
      </label>
      <label className={bad("expectedResult")}>
        <span>Expected result</span>
        <textarea name="expectedResult" rows={2} defaultValue={testCase.expectedResult} required disabled={pending} />
      </label>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0 var(--sp-3)" }}>
        <label className={bad("cycle")}>
          <span>Cycle</span>
          <input name="cycle" defaultValue={testCase.cycle} required disabled={pending} />
        </label>
        <label className={bad("sprint")}>
          <span>Sprint</span>
          <input name="sprint" defaultValue={testCase.sprint} required disabled={pending} />
        </label>
        <label className={bad("release")}>
          <span>Release</span>
          <input name="release" defaultValue={testCase.release} required disabled={pending} />
        </label>
        <label className={bad("environment")}>
          <span>Environment</span>
          <input name="environment" defaultValue={testCase.environment} required disabled={pending} />
        </label>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 var(--sp-4)" }}>
        <label className={bad("priority")}>
          <span>Priority</span>
          <select name="priority" defaultValue={testCase.priority} required disabled={pending}>
            {priorities.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className={bad("severity")}>
          <span>Severity</span>
          <select name="severity" defaultValue={testCase.severity} required disabled={pending}>
            {severities.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>

      <button className="btn" type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save draft"}
      </button>
    </form>
  );
}

// Controlled rows with STABLE keys, not array indices: with index keys and
// uncontrolled inputs, removing a middle step made React reuse the remaining DOM
// nodes in order — so the LAST row's text vanished instead of the removed one's.
// The counter is module-scope (not a ref) because keys only need uniqueness, and
// refs must not be read during render.
let stepRowKey = 0;
function makeRow(action = "", expectedResult = "") {
  return { key: stepRowKey++, action, expectedResult };
}

export function StepsEditor({
  testCaseId,
  version,
  steps
}: {
  testCaseId: string;
  version: number;
  steps: Array<{ action: string; expectedResult: string }>;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(replaceStepsAction, null);
  const [rows, setRows] = useState(() =>
    steps.length > 0 ? steps.map((s) => makeRow(s.action, s.expectedResult)) : [makeRow()]
  );

  const edit = (key: number, patch: Partial<{ action: string; expectedResult: string }>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  return (
    <form action={formAction}>
      <input type="hidden" name="testCaseId" value={testCaseId} />
      <input type="hidden" name="version" value={version} />
      <FormNotice state={state} />

      {rows.map((row, index) => (
        <div key={row.key} style={{ display: "flex", gap: "var(--sp-3)", alignItems: "flex-start" }}>
          <span className="bid" style={{ paddingTop: 34, minWidth: 20, textAlign: "right" }}>
            {index + 1}
          </span>
          <label className="field" style={{ flex: 1 }}>
            <span>Action</span>
            <input
              name="stepAction"
              value={row.action}
              onChange={(e) => edit(row.key, { action: e.target.value })}
              disabled={pending}
            />
          </label>
          <label className="field" style={{ flex: 1 }}>
            <span>Expected</span>
            <input
              name="stepExpected"
              value={row.expectedResult}
              onChange={(e) => edit(row.key, { expectedResult: e.target.value })}
              disabled={pending}
            />
          </label>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ marginTop: 26, padding: "5px 10px", fontSize: 13 }}
            onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}
            disabled={pending || rows.length === 1}
            aria-label={`Remove step ${index + 1}`}
          >
            Remove
          </button>
        </div>
      ))}

      <div style={{ display: "flex", gap: "var(--sp-3)", marginTop: "var(--sp-2)" }}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setRows((current) => [...current, makeRow()])}
          disabled={pending}
        >
          Add step
        </button>
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save steps"}
        </button>
      </div>
      <p className="hint muted" style={{ marginTop: "var(--sp-2)" }}>
        Steps are replaced as a whole and renumbered 1…n in the order shown.
      </p>
    </form>
  );
}

/** One-button lifecycle actions with a shared shape: submit, approve. */
export function LifecycleButton({
  testCaseId,
  version,
  kind,
  label,
  warning
}: {
  testCaseId: string;
  version: number;
  kind: "submit" | "approve";
  label: string;
  warning?: string;
}) {
  const action = kind === "submit" ? submitTestCaseAction : approveTestCaseAction;
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, null);

  return (
    <form action={formAction} style={{ marginBottom: "var(--sp-3)" }}>
      <input type="hidden" name="testCaseId" value={testCaseId} />
      <input type="hidden" name="version" value={version} />
      <FormNotice state={state} />
      {warning ? (
        <p className="why" style={{ marginBottom: "var(--sp-3)" }}>
          {warning}
        </p>
      ) : null}
      <button className="btn" type="submit" disabled={pending}>
        {pending ? "Working…" : label}
      </button>
    </form>
  );
}

export function ReturnToDraftForm({ testCaseId, version }: { testCaseId: string; version: number }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(returnToDraftAction, null);
  const bad = (field: string) => (state?.field === field ? "field field-bad" : "field");

  return (
    <form action={formAction}>
      <input type="hidden" name="testCaseId" value={testCaseId} />
      <input type="hidden" name="version" value={version} />
      <FormNotice state={state} />
      <label className={bad("reviewReason")}>
        <span>Review feedback</span>
        <textarea name="reviewReason" rows={2} required disabled={pending} />
        <span className="hint">Recorded with the case — the author sees exactly this.</span>
      </label>
      <button className="btn btn-secondary" type="submit" disabled={pending}>
        {pending ? "Returning…" : "Return to Draft"}
      </button>
    </form>
  );
}

export function RetireForm({ testCaseId, version }: { testCaseId: string; version: number }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(retireTestCaseAction, null);
  const bad = (field: string) => (state?.field === field ? "field field-bad" : "field");

  return (
    <form action={formAction}>
      <input type="hidden" name="testCaseId" value={testCaseId} />
      <input type="hidden" name="version" value={version} />
      <FormNotice state={state} />
      <label className={bad("retirementReason")}>
        <span>Retirement reason</span>
        <textarea name="retirementReason" rows={2} required disabled={pending} />
      </label>
      <p className="why" style={{ marginBottom: "var(--sp-3)" }}>
        <strong>Retiring preserves the case.</strong> Historical executions keep referencing it; it
        simply stops counting as active.
      </p>
      <button className="btn btn-secondary" type="submit" disabled={pending}>
        {pending ? "Retiring…" : "Retire this case"}
      </button>
    </form>
  );
}
