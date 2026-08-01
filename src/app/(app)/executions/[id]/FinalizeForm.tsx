"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";
import { FormNotice } from "@/ui/notice";
import { fieldClass, fieldProps, noticeId } from "@/ui/form";
import { finalizeExecutionAction, type FormState } from "./actions";

const FORM_ID = "finalize-execution";

export type FinalizeCase = {
  testCaseId: string;
  businessId: string;
  title: string;
  /** Open defects already raised against this case — link targets for a Fail. */
  openDefects: Array<{ id: string; businessId: string; summary: string }>;
};

/**
 * Finalizing is the only irreversible step a tester takes: a finalized execution
 * cannot return to In Progress (`docs/roles-workflows.md:39`), and the history rows it
 * writes are append-only. So the form says so before the button, and the conditional
 * fields appear as soon as a result is chosen rather than after a rejected submit.
 *
 * Every covered case gets its own result section — all results arrive in this one
 * request, there is no partial finalize (`docs/business-rules-and-validation.md:28`).
 * A failing case needs a same-case defect: one of its open defects from the select, or
 * a summary to raise a new one (its BUG-#### is allocated by the server).
 *
 * With several cases the sections collapse to keep the column scannable: the progress
 * line counts recorded results, a check marks done sections, and submitting expands
 * everything first (flushSync) so native validation can focus a hidden control. A
 * server-side rejection expands and scrolls to the section owning the failed field.
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
  cases: FinalizeCase[];
  priorities: string[];
  severities: string[];
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    finalizeExecutionAction,
    null
  );
  const [outcomes, setOutcomes] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(cases.map((covered, index) => [covered.testCaseId, index === 0]))
  );
  const sectionRefs = useRef(new Map<string, HTMLFieldSetElement>());

  const bad = (field: string) => fieldClass(state, field);
  const single = cases.length === 1;
  const recorded = cases.filter((covered) => outcomes[covered.testCaseId]).length;

  // A rejected submit names one field (the FormState contract): expand the section
  // that owns it, so the error is never hidden in a collapsed case. Expansion is a
  // state adjustment, done during render per the React "adjusting state when props
  // change" pattern — only the scroll (a DOM interaction) lives in the effect below.
  const errorMatch = state?.field?.match(/^results\[(\d+)\]/);
  const errorCaseId = errorMatch ? cases[Number(errorMatch[1])]?.testCaseId : undefined;
  const [handledState, setHandledState] = useState<FormState>(null);
  if (state !== handledState) {
    setHandledState(state);
    if (errorCaseId) setExpanded((prev) => ({ ...prev, [errorCaseId]: true }));
  }

  useEffect(() => {
    if (!state || !errorCaseId) return;
    sectionRefs.current.get(errorCaseId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [state, errorCaseId]);

  const expandAll = () => {
    // Synchronously, so the sections are visible before the browser runs native
    // constraint validation on this very submit.
    flushSync(() => {
      setExpanded(Object.fromEntries(cases.map((covered) => [covered.testCaseId, true])));
    });
  };

  return (
    <form action={formAction}>
      <input type="hidden" name="executionId" value={executionId} />
      <input type="hidden" name="version" value={version} />

      <FormNotice state={state} id={noticeId(FORM_ID)} />

      {!single ? (
        <p className="muted">
          {recorded} of {cases.length} cases recorded.
        </p>
      ) : null}

      {cases.map((covered, index) => {
        const outcome = outcomes[covered.testCaseId] ?? "";
        const isExpanded = single || (expanded[covered.testCaseId] ?? false);
        const field = (name: string) => `results[${index}].${name}`;
        const control = (name: string) => `${name}:${covered.testCaseId}`;

        return (
          <fieldset
            key={covered.testCaseId}
            className="form-section"
            ref={(node) => {
              if (node) sectionRefs.current.set(covered.testCaseId, node);
              else sectionRefs.current.delete(covered.testCaseId);
            }}
          >
            <legend>{single ? "Result" : covered.businessId}</legend>
            <input type="hidden" name="caseIds" value={covered.testCaseId} />

            {!single ? (
              <div className="row">
                {outcome ? <CheckCircle2 size={16} aria-hidden /> : null}
                <span className="row-main">{covered.title}</span>
                <button
                  type="button"
                  className="icon-btn"
                  aria-expanded={isExpanded}
                  aria-label={`${isExpanded ? "Collapse" : "Expand"} ${covered.businessId}`}
                  onClick={() =>
                    setExpanded((prev) => ({ ...prev, [covered.testCaseId]: !isExpanded }))
                  }
                >
                  {isExpanded ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
                </button>
              </div>
            ) : null}

            {/* Collapsed sections keep their controls mounted (a plain hidden div), so
                nothing typed is lost and every case still submits. */}
            <div hidden={!isExpanded}>
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
                  <p className="muted">
                    A failed case needs a defect against this same test case. Pick one of its open
                    defects, or describe a new one — its BUG number is assigned automatically.
                  </p>

                  {covered.openDefects.length > 0 ? (
                    <label className={bad(field("defectId"))}>
                      <span>Existing defect</span>
                      <select
                        name={control("defectId")}
                        defaultValue=""
                        disabled={pending}
                        {...fieldProps(state, field("defectId"), FORM_ID)}
                      >
                        <option value="">None — raise a new defect below</option>
                        {covered.openDefects.map((defect) => (
                          <option key={defect.id} value={defect.id}>
                            {defect.businessId} · {defect.summary}
                          </option>
                        ))}
                      </select>
                      <span className="hint">Open defects already raised against this case.</span>
                    </label>
                  ) : null}

                  <label className={bad(field("createDefect.summary"))}>
                    <span>New defect summary</span>
                    <input
                      name={control("defectSummary")}
                      disabled={pending}
                      {...fieldProps(state, field("createDefect.summary"), FORM_ID)}
                    />
                    {covered.openDefects.length > 0 ? (
                      <span className="hint">Leave blank when linking an existing defect above.</span>
                    ) : null}
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
                  <p className="muted">
                    Priority and severity can wait — they are required before the defect is
                    triaged, not to raise it.
                  </p>
                </>
              ) : null}
            </div>
          </fieldset>
        );
      })}

      <p className="why" style={{ marginBottom: "var(--sp-4)" }}>
        <strong>Finalizing can&rsquo;t be undone.</strong> Every case gets its result in this one
        submit, a finalized execution never returns to In Progress, and this writes a permanent
        history entry per case. If any case needs repeating, that is a new execution covering the
        failed or blocked case(s).
      </p>

      <button className="btn" type="submit" disabled={pending} onClick={single ? undefined : expandAll}>
        {pending ? "Finalizing…" : "Finalize this run"}
      </button>
    </form>
  );
}
