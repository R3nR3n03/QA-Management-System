"use client";

import { useActionState, useState } from "react";
import { FormNotice } from "@/ui/notice";
import type { FormState } from "@/ui/action";
import { fieldClass, fieldProps, noticeId } from "@/ui/form";
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

const DRAFT_EDIT_FORM_ID = "edit-draft";

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
  const bad = (field: string) => fieldClass(state, field);

  return (
    <form action={formAction}>
      <input type="hidden" name="testCaseId" value={testCase.id} />
      <input type="hidden" name="version" value={testCase.version} />
      <FormNotice state={state} id={noticeId(DRAFT_EDIT_FORM_ID)} />

      <label className={bad("title")}>
        <span>Title</span>
        <input name="title" defaultValue={testCase.title} required disabled={pending} {...fieldProps(state, "title", DRAFT_EDIT_FORM_ID)} />
      </label>
      <label className={bad("objective")}>
        <span>Objective</span>
        <textarea name="objective" rows={2} defaultValue={testCase.objective} required disabled={pending} {...fieldProps(state, "objective", DRAFT_EDIT_FORM_ID)} />
      </label>
      <label className={bad("expectedResult")}>
        <span>Expected result</span>
        <textarea name="expectedResult" rows={2} defaultValue={testCase.expectedResult} required disabled={pending} {...fieldProps(state, "expectedResult", DRAFT_EDIT_FORM_ID)} />
      </label>

      <div className="form-grid-4">
        <label className={bad("cycle")}>
          <span>Cycle</span>
          <input name="cycle" defaultValue={testCase.cycle} required disabled={pending} {...fieldProps(state, "cycle", DRAFT_EDIT_FORM_ID)} />
        </label>
        <label className={bad("sprint")}>
          <span>Sprint</span>
          <input name="sprint" defaultValue={testCase.sprint} required disabled={pending} {...fieldProps(state, "sprint", DRAFT_EDIT_FORM_ID)} />
        </label>
        <label className={bad("release")}>
          <span>Release</span>
          <input name="release" defaultValue={testCase.release} required disabled={pending} {...fieldProps(state, "release", DRAFT_EDIT_FORM_ID)} />
        </label>
        <label className={bad("environment")}>
          <span>Environment</span>
          <input name="environment" defaultValue={testCase.environment} required disabled={pending} {...fieldProps(state, "environment", DRAFT_EDIT_FORM_ID)} />
        </label>
      </div>

      <div className="form-grid-2">
        <label className={bad("priority")}>
          <span>Priority</span>
          <select name="priority" defaultValue={testCase.priority} required disabled={pending} {...fieldProps(state, "priority", DRAFT_EDIT_FORM_ID)}>
            {priorities.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className={bad("severity")}>
          <span>Severity</span>
          <select name="severity" defaultValue={testCase.severity} required disabled={pending} {...fieldProps(state, "severity", DRAFT_EDIT_FORM_ID)}>
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
const STEPS_FORM_ID = "edit-steps";

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
      <FormNotice state={state} id={noticeId(STEPS_FORM_ID)} />

      {rows.map((row, index) => (
        <div key={row.key} className="steps-row">
          {/* The width and the alignment are `.steps-row .steps-index`'s, not this element's —
              they exist so the Action field does not shift between step 9 and step 10, which is
              a layout rule and not something one call site decides. */}
          <span className="steps-index">{index + 1}</span>
          <label className="field">
            <span>Action</span>
            <input
              name="stepAction"
              value={row.action}
              onChange={(e) => edit(row.key, { action: e.target.value })}
              disabled={pending}
            />
          </label>
          <label className="field">
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
            className="btn btn-secondary btn-sm"
            onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}
            disabled={pending || rows.length === 1}
            aria-label={`Remove step ${index + 1}`}
          >
            Remove
          </button>
        </div>
      ))}

      <div className="row steps-commit">
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
      <p className="hint muted">
        Steps are replaced as a whole and renumbered 1…n in the order shown.
      </p>
    </form>
  );
}

/** One-button lifecycle actions with a shared shape: submit, approve. */
const LIFECYCLE_FORM_ID = "case-lifecycle";

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
    /* No bottom margin of its own. This renders as the only thing in a card ("Submit for
       review") and as the first of two halves in another ("Review"), and in the first case a
       trailing margin is dead space at the card's edge — so the space between this and whatever
       follows belongs to that card, not to the form (`.review-alt`). */
    <form action={formAction} className="lifecycle-form">
      <input type="hidden" name="testCaseId" value={testCaseId} />
      <input type="hidden" name="version" value={version} />
      <FormNotice state={state} id={noticeId(LIFECYCLE_FORM_ID)} />
      {warning ? <p className="why">{warning}</p> : null}
      <button className="btn" type="submit" disabled={pending}>
        {pending ? "Working…" : label}
      </button>
    </form>
  );
}

const RETURN_TO_DRAFT_FORM_ID = "return-to-draft";

export function ReturnToDraftForm({ testCaseId, version }: { testCaseId: string; version: number }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(returnToDraftAction, null);
  const bad = (field: string) => fieldClass(state, field);

  return (
    <form action={formAction}>
      <input type="hidden" name="testCaseId" value={testCaseId} />
      <input type="hidden" name="version" value={version} />
      <FormNotice state={state} id={noticeId(RETURN_TO_DRAFT_FORM_ID)} />
      <label className={bad("reviewReason")}>
        <span>Review feedback</span>
        <textarea name="reviewReason" rows={2} required disabled={pending} {...fieldProps(state, "reviewReason", RETURN_TO_DRAFT_FORM_ID)} />
        <span className="hint">Recorded with the case — the author sees exactly this.</span>
      </label>
      <button className="btn btn-secondary" type="submit" disabled={pending}>
        {pending ? "Returning…" : "Return to Draft"}
      </button>
    </form>
  );
}

const RETIRE_FORM_ID = "retire-case";

export function RetireForm({ testCaseId, version }: { testCaseId: string; version: number }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(retireTestCaseAction, null);
  const bad = (field: string) => fieldClass(state, field);

  return (
    <form action={formAction} className="lifecycle-form">
      <input type="hidden" name="testCaseId" value={testCaseId} />
      <input type="hidden" name="version" value={version} />
      <FormNotice state={state} id={noticeId(RETIRE_FORM_ID)} />
      <label className={bad("retirementReason")}>
        <span>Retirement reason</span>
        <textarea name="retirementReason" rows={2} required disabled={pending} {...fieldProps(state, "retirementReason", RETIRE_FORM_ID)} />
      </label>
      {/* Spaced by `.lifecycle-form > .why`, the same rule the submit and approve forms use:
          consequence, then the control that accepts it. */}
      <p className="why">
        <strong>Retiring preserves the case.</strong> Historical executions keep referencing it; it
        simply stops counting as active.
      </p>
      <button className="btn btn-danger" type="submit" disabled={pending}>
        {pending ? "Retiring…" : "Retire this case"}
      </button>
    </form>
  );
}
