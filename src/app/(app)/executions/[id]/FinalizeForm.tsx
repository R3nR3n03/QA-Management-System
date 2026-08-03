"use client";

import { Fragment, useActionState, useState, type FormEvent } from "react";
import { CheckCircle2, ChevronRight, Circle } from "lucide-react";
import { Modal } from "@/ui/modal";
import { FormNotice } from "@/ui/notice";
import { fieldClass, fieldProps, noticeId } from "@/ui/form";
import { finalizeExecutionAction, type FormState } from "./actions";

const FORM_ID = "finalize-execution";
const CASE_FORM_ID = "finalize-case";

export type FinalizeCase = {
  testCaseId: string;
  businessId: string;
  title: string;
  /** Open defects already raised against this case — link targets for a Fail. */
  openDefects: Array<{ id: string; businessId: string; summary: string }>;
};

/** One case's result, held client-side until the whole run is finalized. */
type CaseResult = {
  result: string;
  actualResult: string;
  blockReason: string;
  defectId: string;
  defectSummary: string;
  defectPriority: string;
  defectSeverity: string;
};

const EMPTY_RESULT: CaseResult = {
  result: "",
  actualResult: "",
  blockReason: "",
  defectId: "",
  defectSummary: "",
  defectPriority: "",
  defectSeverity: ""
};

/* Outcome badges are spelled out here rather than imported from `@/ui/chips`, which
   reads its labels off the Prisma enums — importing that module into a client
   component would pull `@prisma/client` into the browser bundle. */
const OUTCOME_LABEL: Record<string, string> = { PASS: "Pass", FAIL: "Fail", BLOCKED: "Blocked" };
const OUTCOME_TONE: Record<string, string> = {
  PASS: "state state-pass",
  FAIL: "state state-fail",
  BLOCKED: "state state-blocked"
};

/**
 * Finalizing is the only irreversible step a tester takes: a finalized execution
 * cannot return to In Progress (`docs/roles-workflows.md:39`), and the history rows it
 * writes are append-only.
 *
 * ## Why the modal holds results instead of committing them
 *
 * Each covered case is clicked open and its result recorded in a dialog, but **Save
 * result only holds the values in this component**. `docs/business-rules-and-validation.md:28`
 * is explicit that "there is no partial finalize": every covered case gets its result in
 * ONE request, or none does. So the dialog is data entry and the run's single
 * "Finalize this run" submit is the commit — the button stays disabled until every case
 * has been recorded, and the hidden inputs below carry all of them together.
 *
 * That is also why nothing here is a nested `<form>` inside the outer one: the dialog's
 * controls live outside it entirely, and only the hidden mirrors of saved results are
 * part of the submitted body.
 *
 * ## What this costs
 *
 * Recording a result now requires JavaScript — the previous inline fieldsets submitted
 * without it. The submit itself still degrades: the hidden inputs are ordinary form
 * fields, so a saved run posts normally. Every rule below is ALSO enforced in
 * `src/domain/executions.ts`; revealing a field early or blocking Save is a courtesy,
 * never the gate.
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
  const [recorded, setRecorded] = useState<Record<string, CaseResult>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CaseResult>(EMPTY_RESULT);
  const [draftError, setDraftError] = useState<string | null>(null);

  const openIndex = openId === null ? -1 : cases.findIndex((row) => row.testCaseId === openId);
  const openCase = openIndex >= 0 ? cases[openIndex] : null;

  const recordedCount = cases.filter((covered) => recorded[covered.testCaseId]).length;
  const allRecorded = recordedCount === cases.length;

  // A rejected submit names one field (the FormState contract). Reopen the case that
  // owns it, so the error is never behind a closed dialog. This is a state adjustment
  // during render — the React "adjusting state when props change" pattern — so the
  // dialog is already open on the paint that shows the notice.
  const errorMatch = state?.field?.match(/^results\[(\d+)\]/);
  const errorCaseId = errorMatch ? cases[Number(errorMatch[1])]?.testCaseId : undefined;
  const [handledState, setHandledState] = useState<FormState>(null);
  if (state !== handledState) {
    setHandledState(state);
    if (errorCaseId) {
      setDraft(recorded[errorCaseId] ?? EMPTY_RESULT);
      setDraftError(null);
      setOpenId(errorCaseId);
    }
  }

  const openForCase = (testCaseId: string) => {
    setDraft(recorded[testCaseId] ?? EMPTY_RESULT);
    setDraftError(null);
    setOpenId(testCaseId);
  };

  /* Switching outcome clears the fields the previous outcome owned. A Pass must not
     carry a defect (`docs/business-rules-and-validation.md:30`), and a stale block
     reason left over from a Blocked would travel with a Fail. */
  const setOutcome = (result: string) => {
    setDraft((prev) => ({
      ...prev,
      result,
      blockReason: result === "BLOCKED" ? prev.blockReason : "",
      defectId: result === "FAIL" ? prev.defectId : "",
      defectSummary: result === "FAIL" ? prev.defectSummary : "",
      defectPriority: result === "FAIL" ? prev.defectPriority : "",
      defectSeverity: result === "FAIL" ? prev.defectSeverity : ""
    }));
    setDraftError(null);
  };

  const saveDraft = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!openCase) return;
    // The one rule native validation cannot state: a Fail is satisfied by EITHER an
    // existing defect or a new summary, and `required` cannot express an or.
    if (draft.result === "FAIL" && draft.defectId === "" && draft.defectSummary.trim() === "") {
      // Distinct wording from the standing paragraph above the fields — repeating that
      // sentence back would read as the same text twice rather than as a correction.
      setDraftError(
        openCase.openDefects.length > 0
          ? "Select one of its open defects, or write a summary for a new one."
          : "Write a summary for the new defect this failure raises."
      );
      return;
    }
    setDraftError(null);
    setRecorded((prev) => ({ ...prev, [openCase.testCaseId]: draft }));
    setOpenId(null);
  };

  const bad = (field: string) => fieldClass(state, field);
  const field = (name: string) => `results[${openIndex}].${name}`;

  return (
    <>
      <form action={formAction}>
        <input type="hidden" name="executionId" value={executionId} />
        <input type="hidden" name="version" value={version} />

        {/* Every covered case posts, recorded or not, and in the order rendered — the
            action pairs `caseIds` with `results[index]` positionally. An unrecorded case
            travels blank on purpose: the server must see the whole set and reject a
            partial run, not silently finalize a subset of it. */}
        {cases.map((covered) => {
          const saved = recorded[covered.testCaseId] ?? EMPTY_RESULT;
          const id = covered.testCaseId;
          const failed = saved.result === "FAIL";
          return (
            <Fragment key={id}>
              <input type="hidden" name="caseIds" value={id} />
              <input type="hidden" name={`result:${id}`} value={saved.result} />
              <input type="hidden" name={`actualResult:${id}`} value={saved.actualResult} />
              <input
                type="hidden"
                name={`blockReason:${id}`}
                value={saved.result === "BLOCKED" ? saved.blockReason : ""}
              />
              <input type="hidden" name={`defectId:${id}`} value={failed ? saved.defectId : ""} />
              <input
                type="hidden"
                name={`defectSummary:${id}`}
                value={failed ? saved.defectSummary : ""}
              />
              <input
                type="hidden"
                name={`defectPriority:${id}`}
                value={failed ? saved.defectPriority : ""}
              />
              <input
                type="hidden"
                name={`defectSeverity:${id}`}
                value={failed ? saved.defectSeverity : ""}
              />
            </Fragment>
          );
        })}

        <FormNotice state={state} id={noticeId(FORM_ID)} />

        <p className="muted">
          {recordedCount} of {cases.length} case{cases.length === 1 ? "" : "s"} recorded.
        </p>

        <ul className="case-picker">
          {cases.map((covered) => {
            const saved = recorded[covered.testCaseId];
            const isErrored = errorCaseId === covered.testCaseId;
            return (
              <li key={covered.testCaseId}>
                <button
                  type="button"
                  className={isErrored ? "case-pick case-pick-bad" : "case-pick"}
                  onClick={() => openForCase(covered.testCaseId)}
                  disabled={pending}
                  aria-haspopup="dialog"
                >
                  <span
                    className={saved ? "case-pick-mark case-pick-mark-done" : "case-pick-mark"}
                    aria-hidden
                  >
                    {saved ? <CheckCircle2 size={16} /> : <Circle size={16} />}
                  </span>
                  <span className="row-main">
                    <span className="bid">{covered.businessId}</span>
                    <span className="row-title">{covered.title}</span>
                  </span>
                  {saved ? (
                    <span className={OUTCOME_TONE[saved.result]}>{OUTCOME_LABEL[saved.result]}</span>
                  ) : (
                    <span className="muted">Not recorded</span>
                  )}
                  <ChevronRight size={14} aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>

        <p className="why" style={{ marginBottom: "var(--sp-4)" }}>
          <strong>Finalizing can&rsquo;t be undone.</strong> Every case gets its result in this one
          submit, a finalized execution never returns to In Progress, and this writes a permanent
          history entry per case. If any case needs repeating, that is a new execution covering the
          failed or blocked case(s).
        </p>

        <button className="btn" type="submit" disabled={pending || !allRecorded}>
          {pending ? "Finalizing…" : "Finalize this run"}
        </button>
        {!allRecorded ? (
          <p className="hint" style={{ marginTop: "var(--sp-2)" }}>
            Record every case first — a run finalizes whole or not at all.
          </p>
        ) : null}
      </form>

      <Modal
        open={openCase !== null}
        onClose={() => setOpenId(null)}
        title={openCase ? openCase.businessId : ""}
        description={openCase?.title}
        size="md"
        /* Only while a case is open: a closed dialog should not leave its buttons in
           the tree for a screen reader or a test to reach. */
        footer={
          openCase ? (
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setOpenId(null)}>
                Cancel
              </button>
              <button type="submit" form={CASE_FORM_ID} className="btn">
                Save result
              </button>
            </>
          ) : undefined
        }
      >
        {openCase ? (
          <form id={CASE_FORM_ID} onSubmit={saveDraft}>
            {state && errorCaseId === openCase.testCaseId ? (
              <FormNotice state={state} id={noticeId(CASE_FORM_ID)} />
            ) : null}
            {draftError ? (
              <div id={noticeId(CASE_FORM_ID)} className="notice" role="alert">
                <strong>This case still needs a defect</strong>
                <span>{draftError}</span>
              </div>
            ) : null}

            <label className={bad(field("result"))}>
              <span>Result</span>
              <select
                value={draft.result}
                onChange={(e) => setOutcome(e.target.value)}
                required
                autoFocus
                {...fieldProps(state, field("result"), CASE_FORM_ID)}
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
                rows={3}
                required
                value={draft.actualResult}
                onChange={(e) => setDraft((prev) => ({ ...prev, actualResult: e.target.value }))}
                {...fieldProps(state, field("actualResult"), CASE_FORM_ID)}
              />
              <span className="hint">
                This is the evidence the result rests on, so it is kept with the execution
                permanently.
              </span>
            </label>

            {draft.result === "BLOCKED" ? (
              <label className={bad(field("blockReason"))}>
                <span>What blocked it</span>
                <textarea
                  rows={2}
                  required
                  value={draft.blockReason}
                  onChange={(e) => setDraft((prev) => ({ ...prev, blockReason: e.target.value }))}
                  {...fieldProps(state, field("blockReason"), CASE_FORM_ID)}
                />
                <span className="hint">
                  Say what stopped this case, so whoever picks it up knows where to start.
                </span>
              </label>
            ) : null}

            {draft.result === "FAIL" ? (
              <>
                <p className="muted">
                  A failed case needs a defect against this same test case. Pick one of its open
                  defects, or describe a new one — its BUG number is assigned automatically.
                </p>

                {openCase.openDefects.length > 0 ? (
                  <label className={bad(field("defectId"))}>
                    <span>Existing defect</span>
                    <select
                      value={draft.defectId}
                      onChange={(e) => {
                        setDraft((prev) => ({ ...prev, defectId: e.target.value }));
                        setDraftError(null);
                      }}
                      {...fieldProps(state, field("defectId"), CASE_FORM_ID)}
                    >
                      <option value="">None — raise a new defect below</option>
                      {openCase.openDefects.map((defect) => (
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
                    value={draft.defectSummary}
                    onChange={(e) => {
                      setDraft((prev) => ({ ...prev, defectSummary: e.target.value }));
                      setDraftError(null);
                    }}
                    {...fieldProps(state, field("createDefect.summary"), CASE_FORM_ID)}
                  />
                  {openCase.openDefects.length > 0 ? (
                    <span className="hint">Leave blank when linking an existing defect above.</span>
                  ) : null}
                </label>

                <div className="form-grid-2">
                  <label className={bad(field("createDefect.priority"))}>
                    <span>Priority</span>
                    <select
                      value={draft.defectPriority}
                      onChange={(e) =>
                        setDraft((prev) => ({ ...prev, defectPriority: e.target.value }))
                      }
                      {...fieldProps(state, field("createDefect.priority"), CASE_FORM_ID)}
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
                      value={draft.defectSeverity}
                      onChange={(e) =>
                        setDraft((prev) => ({ ...prev, defectSeverity: e.target.value }))
                      }
                      {...fieldProps(state, field("createDefect.severity"), CASE_FORM_ID)}
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
                  Priority and severity can wait — they are required before the defect is triaged,
                  not to raise it.
                </p>
              </>
            ) : null}

            <p className="hint">
              Saving holds this result on the run. Nothing is written until you finalize.
            </p>
          </form>
        ) : null}
      </Modal>
    </>
  );
}
