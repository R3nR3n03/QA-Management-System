"use client";

import { useActionState, useState } from "react";
import { FormNotice } from "@/ui/notice";
import { fieldClass, fieldProps, noticeId } from "@/ui/form";
import { finalizeExecutionAction, type FormState } from "./actions";

const FORM_ID = "finalize-execution";

/**
 * Finalizing is the only irreversible step a tester takes: a finalized execution
 * cannot return to In Progress (`docs/roles-workflows.md:39`), and the history rows it
 * writes are append-only. So the form says so before the button, and the conditional
 * fields appear as soon as a result is chosen rather than after a rejected submit.
 *
 * Every covered case gets its own result row — all results arrive in this one request,
 * there is no partial finalize (`docs/business-rules-and-validation.md:28`). A failing
 * case needs a same-case defect: an existing defect ID, or the fields to raise one now.
 *
 * The conditional rules are ALSO enforced in `src/domain/executions.ts`. Revealing a
 * field early is a courtesy, not the gate — a submit with JavaScript disabled still
 * hits the same server-side checks and gets the same message back.
 */
export function FinalizeForm({
  executionId,
  version,
  cases,
  priorities,
  severities
}: {
  executionId: string;
  version: number;
  cases: Array<{ testCaseId: string; businessId: string; title: string }>;
  priorities: string[];
  severities: string[];
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    finalizeExecutionAction,
    null
  );
  const [outcomes, setOutcomes] = useState<Record<string, string>>({});

  const bad = (field: string) => fieldClass(state, field);
  const single = cases.length === 1;

  return (
    <form action={formAction}>
      <input type="hidden" name="executionId" value={executionId} />
      <input type="hidden" name="version" value={version} />

      <FormNotice state={state} id={noticeId(FORM_ID)} />

      {cases.map((covered, index) => {
        const outcome = outcomes[covered.testCaseId] ?? "";
        const field = (name: string) => `results[${index}].${name}`;
        const control = (name: string) => `${name}:${covered.testCaseId}`;

        return (
          <fieldset key={covered.testCaseId} className="form-section">
            <legend>
              {single ? "Result" : (
                <>
                  {covered.businessId} · {covered.title}
                </>
              )}
            </legend>
            <input type="hidden" name="caseIds" value={covered.testCaseId} />

            <label className={bad(field("result"))}>
              <span>Result</span>
              <select
                name={control("result")}
                required
                value={outcome}
                onChange={(e) =>
                  setOutcomes((prev) => ({ ...prev, [covered.testCaseId]: e.target.value }))
                }
                disabled={pending}
                {...fieldProps(state, field("result"), FORM_ID)}
              >
                <option value="" disabled>
                  Choose a result…
                </option>
                <option value="PASS">Pass</option>
                <option value="FAIL">Fail</option>
                <option value="BLOCKED">Blocked</option>
              </select>
            </label>

            <label className={bad(field("actualResult"))}>
              <span>What actually happened</span>
              <textarea
                name={control("actualResult")}
                rows={3}
                required
                disabled={pending}
                {...fieldProps(state, field("actualResult"), FORM_ID)}
              />
              <span className="hint">
                This is the evidence the result rests on, so it is kept with the execution
                permanently.
              </span>
            </label>

            {outcome === "BLOCKED" ? (
              <label className={bad(field("blockReason"))}>
                <span>What blocked it</span>
                <textarea
                  name={control("blockReason")}
                  rows={2}
                  disabled={pending}
                  {...fieldProps(state, field("blockReason"), FORM_ID)}
                />
                <span className="hint">
                  Say what stopped this case, so whoever picks it up knows where to start.
                </span>
              </label>
            ) : null}

            {outcome === "FAIL" ? (
              <>
                <p className="muted" style={{ marginBottom: "var(--sp-3)" }}>
                  A failed case needs a defect against this same test case. Reference an existing
                  defect, or fill in the fields below to raise one now.
                </p>

                <label className={bad(field("defectId"))}>
                  <span>Existing defect</span>
                  <input
                    name={control("defectId")}
                    placeholder="Defect record ID"
                    disabled={pending}
                    {...fieldProps(state, field("defectId"), FORM_ID)}
                  />
                  <span className="hint">Leave blank when raising a new defect below.</span>
                </label>

                <label className={bad(field("createDefect.businessId"))}>
                  <span>New defect ID</span>
                  <input
                    name={control("defectBusinessId")}
                    placeholder="BUG-0001"
                    disabled={pending}
                    {...fieldProps(state, field("createDefect.businessId"), FORM_ID)}
                  />
                </label>

                <label className={bad(field("createDefect.summary"))}>
                  <span>Summary</span>
                  <input
                    name={control("defectSummary")}
                    disabled={pending}
                    {...fieldProps(state, field("createDefect.summary"), FORM_ID)}
                  />
                </label>

                <div className="form-grid-2">
                  <label className={bad(field("createDefect.priority"))}>
                    <span>Priority</span>
                    <select
                      name={control("defectPriority")}
                      disabled={pending}
                      defaultValue=""
                      {...fieldProps(state, field("createDefect.priority"), FORM_ID)}
                    >
                      <option value="">Not set yet</option>
                      {priorities.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={bad(field("createDefect.severity"))}>
                    <span>Severity</span>
                    <select
                      name={control("defectSeverity")}
                      disabled={pending}
                      defaultValue=""
                      {...fieldProps(state, field("createDefect.severity"), FORM_ID)}
                    >
                      <option value="">Not set yet</option>
                      {severities.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <p className="muted" style={{ margin: "0 0 var(--sp-2)" }}>
                  Priority and severity can wait — they are required before the defect is triaged,
                  not to raise it.
                </p>
              </>
            ) : null}
          </fieldset>
        );
      })}

      <p className="why" style={{ marginBottom: "var(--sp-4)" }}>
        <strong>Finalizing can&rsquo;t be undone.</strong> Every case gets its result in this one
        submit, a finalized execution never returns to In Progress, and this writes a permanent
        history entry per case. If any case needs repeating, that is a new execution covering the
        failed or blocked case(s).
      </p>

      <button className="btn" type="submit" disabled={pending}>
        {pending ? "Finalizing…" : "Finalize this run"}
      </button>
    </form>
  );
}
