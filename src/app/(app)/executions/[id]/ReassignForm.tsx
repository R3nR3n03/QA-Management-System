"use client";

import { useActionState } from "react";
import { updateExecutionAction, type FormState } from "./actions";

type TesterOption = { id: string; displayName: string; email: string };

/**
 * Reassignment is Planned-only — once a run starts, its tester is part of the record.
 * The state rule, the active-tester rule and the role gate live in `updateExecution`;
 * this form only offers the currently active people.
 */
export function ReassignForm({
  executionId,
  version,
  currentTesterId,
  testers
}: {
  executionId: string;
  version: number;
  currentTesterId: string;
  testers: TesterOption[];
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(updateExecutionAction, null);

  return (
    <form action={formAction} style={{ marginTop: "var(--sp-4)" }}>
      <input type="hidden" name="executionId" value={executionId} />
      <input type="hidden" name="version" value={version} />

      {state ? (
        <div className={state.advisory ? "notice notice-advisory" : "notice"} role="alert">
          <strong>{state.title}</strong>
          <span>{state.detail}</span>
          {state.requestId ? <code>Reference {state.requestId}</code> : null}
        </div>
      ) : null}

      <label className={state?.field === "testerId" ? "field field-bad" : "field"}>
        <span>Reassign to</span>
        <select name="testerId" defaultValue={currentTesterId} disabled={pending}>
          {testers.map((tester) => (
            <option key={tester.id} value={tester.id}>
              {tester.displayName} · {tester.email}
            </option>
          ))}
        </select>
      </label>
      <button className="btn btn-secondary" type="submit" disabled={pending}>
        {pending ? "Reassigning…" : "Reassign"}
      </button>
      <p className="muted" style={{ marginTop: "var(--sp-2)" }}>
        Only a Planned run can be reassigned. Once started, the tester is part of the record.
      </p>
    </form>
  );
}
