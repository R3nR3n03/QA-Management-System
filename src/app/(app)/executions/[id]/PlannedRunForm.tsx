"use client";

import { useActionState, useEffect, useRef } from "react";
import { FormNotice } from "@/ui/notice";
import { useToast } from "@/ui/toast";
import { fieldClass, fieldProps, noticeId } from "@/ui/form";
import { EXECUTION_PURPOSE_MAX_LENGTH } from "@/lib/field-limits";
import { updateExecutionAction, type FormState } from "./actions";

type TesterOption = { id: string; displayName: string; email: string };

const FORM_ID = "edit-planned-run";

/**
 * Everything about a Planned run that can still be changed: its purpose, its tester, and the
 * Jira task it tests. All three freeze at the same moment, for one reason — once a run
 * starts, what it is and who ran it are part of the record — and the rules live in
 * `updateExecution`, not here.
 *
 * ONE form for all three, and not three controls that each save on their own. Every mutable
 * entity here carries a `version` (`docs/business-rules-and-validation.md`), so a second form
 * on the same row would be holding a version that the first form's save has already
 * incremented: saving A then B would reject B with a `409 VERSION_CONFLICT` over an edit
 * that conflicted with nothing. One row, one edit, one version check.
 *
 * Success shows as a toast (the `wasPending` idiom from AddPersonForm): the form has no
 * visible state change of its own — the fields simply keep what was typed — so without it a
 * successful save looks like nothing happened. Failures stay inline in the FormNotice, where
 * they can name the field; toasts are success-only.
 */
export function PlannedRunForm({
  executionId,
  version,
  currentPurpose,
  currentTesterId,
  currentJiraIssueKey,
  testers
}: {
  executionId: string;
  version: number;
  /** What the run exists to check. Required, so this is never empty. */
  currentPurpose: string;
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

      {/*
        First here as it is on the plan screen, and for the same reason: it is the line this
        run is listed under everywhere else. `required` and `maxLength` match the plan form;
        emptying the box is refused by the domain rather than clearing the purpose, because
        there is no such thing as a run with no purpose.
      */}
      <label className={fieldClass(state, "purpose")}>
        <span>Purpose</span>
        <input
          name="purpose"
          type="text"
          required
          maxLength={EXECUTION_PURPOSE_MAX_LENGTH}
          defaultValue={currentPurpose}
          placeholder="Sprint 24 regression, Chrome"
          autoComplete="off"
          disabled={pending}
          {...fieldProps(state, "purpose", FORM_ID)}
        />
      </label>

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
        Only a Planned run can be changed. Once started, the purpose, the tester and the Jira
        issue key are all part of the record. Clearing the key removes the Jira link.
      </p>
    </form>
  );
}
