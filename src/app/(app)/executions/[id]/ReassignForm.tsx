"use client";

import { useActionState, useEffect, useRef } from "react";
import { FormNotice } from "@/ui/notice";
import { useToast } from "@/ui/toast";
import { fieldClass, fieldProps, noticeId } from "@/ui/form";
import { updateExecutionAction, type FormState } from "./actions";

type TesterOption = { id: string; displayName: string; email: string };

const FORM_ID = "reassign-execution";

/**
 * Reassignment is Planned-only — once a run starts, its tester is part of the record.
 * The state rule, the active-tester rule and the role gate live in `updateExecution`;
 * this form only offers the currently active people.
 *
 * Success shows as a toast (the `wasPending` idiom from AddPersonForm): the form has
 * no visible state change of its own — the select simply keeps the new assignee — so
 * without it a successful reassign looks like nothing happened. Failures stay inline
 * in the FormNotice, where they can name the field; toasts are success-only.
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
  const toast = useToast();
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending && state === null) {
      toast("Execution reassigned.");
    }
    wasPending.current = pending;
  }, [pending, state, toast]);

  return (
    <form action={formAction} style={{ marginTop: "var(--sp-4)" }}>
      <input type="hidden" name="executionId" value={executionId} />
      <input type="hidden" name="version" value={version} />

      <FormNotice state={state} id={noticeId(FORM_ID)} />

      <label className={fieldClass(state, "testerId")}>
        <span>Reassign to</span>
        <select name="testerId" defaultValue={currentTesterId} disabled={pending} {...fieldProps(state, "testerId", FORM_ID)}>
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
