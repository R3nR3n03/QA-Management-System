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
  currentJiraIssueKey,
  testers
}: {
  executionId: string;
  version: number;
  currentTesterId: string;
  /** The Jira task this run tests, or `null`. Editable here only while Planned. */
  currentJiraIssueKey: string | null;
  testers: TesterOption[];
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(updateExecutionAction, null);
  const toast = useToast();
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending && state === null) {
      toast("Execution updated.");
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

      {/*
        Rendered ALWAYS, even when empty — the field's presence is what tells the action
        "this form has an opinion about the Jira key", and clearing it is how a key is
        removed. Omitting it when null would make an empty box indistinguishable from a
        form that never mentioned Jira (`readOptionalText`).
      */}
      <label className={fieldClass(state, "jiraIssueKey")}>
        <span>Jira issue key</span>
        <input
          name="jiraIssueKey"
          type="text"
          placeholder="PROJ-123"
          autoComplete="off"
          defaultValue={currentJiraIssueKey ?? ""}
          disabled={pending}
          {...fieldProps(state, "jiraIssueKey", FORM_ID)}
        />
      </label>

      <button className="btn btn-secondary" type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </button>
      <p className="muted" style={{ marginTop: "var(--sp-2)" }}>
        Only a Planned run can be changed. Once started, the tester and the Jira issue key are
        both part of the record. Clearing the key removes the Jira link.
      </p>
    </form>
  );
}
