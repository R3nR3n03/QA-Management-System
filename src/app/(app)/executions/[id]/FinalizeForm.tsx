"use client";

import { Fragment, useActionState, useState, type FormEvent } from "react";
import { CheckCircle2, ChevronRight, Circle } from "lucide-react";
import { Modal } from "@/ui/modal";
import { FormNotice } from "@/ui/notice";
import { StepsDisclosure, type CaseStep } from "@/ui/steps-disclosure";
import { FilterToolbar } from "@/ui/toolbar";
import { fieldClass, fieldProps, noticeId } from "@/ui/form";
import { finalizeExecutionAction, type FormState } from "./actions";
import {
  DRAFT_PREFIX,
  EMPTY_RESULT,
  OUTCOMES,
  draftResults,
  useDraftRaw,
  writeDraft,
  type CaseResult
} from "./finalize-draft";

const FORM_ID = "finalize-execution";
const CASE_FORM_ID = "finalize-case";

export type FinalizeCase = {
  testCaseId: string;
  businessId: string;
  title: string;
  /** The steps this case specifies — what the tester is grading against. */
  steps: CaseStep[];
  /** Open defects already raised against this case — link targets for a Fail. */
  openDefects: Array<{ id: string; businessId: string; summary: string }>;
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
 * ## Why this owns both columns
 *
 * The one `<form>` spans the record's whole two-column layout, so this component renders
 * `.detail-cols` rather than sitting inside the page's aside. The cases being recorded
 * are the work, and they were being worked in a 340px rail while the same six cases sat
 * unusably read-only across the main column — the run's covered cases listed twice, with
 * the copy you could act on in the narrower half. Now the wide column IS the working
 * list and the rail is the commit panel: count, progress, consequence, submit.
 *
 * The form cannot be split across columns the page owns, hence the inversion.
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
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CaseResult>(EMPTY_RESULT);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [needle, setNeedle] = useState("");
  /* Whether anything was recorded on THIS visit, which is what tells a restored draft
     apart from a fresh one. Set from the save handler — an event, not an effect. */
  const [recordedHere, setRecordedHere] = useState(false);

  const storageKey = `${DRAFT_PREFIX}${executionId}`;
  const storedRaw = useDraftRaw(storageKey);
  const recorded = draftResults(
    storedRaw,
    version,
    cases.map((covered) => covered.testCaseId)
  );

  const openIndex = openId === null ? -1 : cases.findIndex((row) => row.testCaseId === openId);
  const openCase = openIndex >= 0 ? cases[openIndex] : null;

  const recordedCount = cases.filter((covered) => recorded[covered.testCaseId]).length;
  const allRecorded = recordedCount === cases.length;

  /* The needle narrows what is SHOWN, never what is submitted: the hidden inputs below
     iterate `cases`, because the server has to see the whole covered set to reject a
     partial run. Offered only past the point a list stops being scannable — the same
     >5 rule the record lists use. */
  const trimmedNeedle = needle.trim().toLowerCase();
  const shownCases =
    trimmedNeedle === ""
      ? cases
      : cases.filter(
          (covered) =>
            covered.businessId.toLowerCase().includes(trimmedNeedle) ||
            covered.title.toLowerCase().includes(trimmedNeedle)
        );

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
    // Straight to the store, which is the single copy of the draft — there is no
    // `useState` mirror to keep in step, so there is nothing to get out of step.
    writeDraft(storageKey, {
      version,
      recorded: { ...recorded, [openCase.testCaseId]: draft }
    });
    setRecordedHere(true);
    setOpenId(null);
  };

  const bad = (field: string) => fieldClass(state, field);
  const field = (name: string) => `results[${openIndex}].${name}`;

  return (
    <>
      <form action={formAction} className="detail-cols">
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

        <div>
          <div className="row" style={{ marginBottom: "var(--sp-3)" }}>
            <h2 style={{ margin: 0, flex: 1 }}>Covered cases ({cases.length})</h2>
            {/* The same >5 rule the record lists use. Controlled, not URL-backed: the
                unsaved results live in this component, so a navigation would lose them. */}
            {cases.length > 5 ? (
              <FilterToolbar
                value={needle}
                onChange={setNeedle}
                placeholder="Search cases…"
                label="Search covered cases"
                disabled={pending}
              />
            ) : null}
          </div>

          <div className="card card-flush">
            {shownCases.length === 0 ? (
              <div className="empty">
                <p>No covered case matches &ldquo;{needle.trim()}&rdquo;.</p>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setNeedle("")}>
                  Clear the search
                </button>
              </div>
            ) : (
              <ul className="row-list">
                {shownCases.map((covered) => {
                  const saved = recorded[covered.testCaseId];
                  const isErrored = errorCaseId === covered.testCaseId;
                  return (
                    <li key={covered.testCaseId} className="case-line">
                      <button
                        type="button"
                        className={isErrored ? "case-open case-open-bad" : "case-open"}
                        onClick={() => openForCase(covered.testCaseId)}
                        disabled={pending}
                        aria-haspopup="dialog"
                      >
                        <span className="case-item-head">
                          <span
                            className={saved ? "case-item-mark case-item-mark-done" : "case-item-mark"}
                            aria-hidden
                          >
                            {saved ? <CheckCircle2 size={16} /> : <Circle size={16} />}
                          </span>
                          <span className="row-main">
                            <span className="cluster">
                              <span className="bid">{covered.businessId}</span>
                              {/* The size of the job this row represents, readable without
                                  opening it. The steps themselves are the disclosure
                                  below — outside the button, because a <details> nested
                                  in one is interactive content inside interactive
                                  content, which no browser resolves sensibly. */}
                              <span className="muted">
                                {covered.steps.length} step
                                {covered.steps.length === 1 ? "" : "s"}
                              </span>
                            </span>
                            <span className="row-title">{covered.title}</span>
                            {/* What was actually recorded, on the row that recorded it.
                                Finalizing is irreversible, so the last look before
                                committing should be a review of the evidence — not a list
                                of ticks that requires reopening every case to remember
                                what each one says. */}
                            {saved?.actualResult ? (
                              <span className="case-pick-said">{saved.actualResult}</span>
                            ) : null}
                          </span>
                          {/* The tone lookup is guarded: an unexpected value would otherwise
                              render `class="undefined"`, an unstyled span where a result chip
                              belongs. The import screens already guard the same lookup. */}
                          {saved ? (
                            <span className={OUTCOME_TONE[saved.result] ?? "state"}>
                              {OUTCOME_LABEL[saved.result] ?? saved.result}
                            </span>
                          ) : (
                            <span className="muted">Not recorded</span>
                          )}
                          <ChevronRight size={14} aria-hidden />
                        </span>
                      </button>
                      {/* Readable without committing to opening the dialog: scanning the
                          steps is how a tester decides which case to pick up next. */}
                      <StepsDisclosure steps={covered.steps} />
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <aside>
          <div className="card">
            <h3>Finalize</h3>

            <FormNotice state={state} id={noticeId(FORM_ID)} />

            {/* A restored draft has to announce itself. "3 of 6 recorded" on a page the
                viewer has just opened otherwise reads as someone else's work, or as a
                run that has already written something. Calm, not red — nothing failed. */}
            {!recordedHere && recordedCount > 0 ? (
              <div className="notice notice-advisory" role="status">
                <strong>Picked up where you left off</strong>
                <span>
                  {recordedCount} result{recordedCount === 1 ? "" : "s"} you recorded earlier{" "}
                  {recordedCount === 1 ? "is" : "are"} still held here. Nothing has been submitted
                  yet.
                </span>
              </div>
            ) : null}

            <p className="muted" style={{ marginBottom: "var(--sp-2)" }}>
              {recordedCount} of {cases.length} case{cases.length === 1 ? "" : "s"} recorded.
            </p>

            {/* The count is the accessible fact; this is the same fact at a glance, so it is
                hidden from assistive tech rather than read out twice. Only worth drawing for
                a run with something to progress through — a one-case bar is either 0% or
                100%, which the sentence above already said. */}
            {cases.length > 1 ? (
              <div className="progress" aria-hidden>
                <div
                  className="progress-fill"
                  style={{ width: `${(recordedCount / cases.length) * 100}%` }}
                />
              </div>
            ) : null}

            <p className="why" style={{ marginBottom: "var(--sp-4)" }}>
              <strong>Finalizing can&rsquo;t be undone.</strong> Every case gets its result in this
              one submit, a finalized execution never returns to In Progress, and this writes a
              permanent history entry per case. If any case needs repeating, that is a new
              execution covering the failed or blocked case(s).
            </p>

            <button className="btn" type="submit" disabled={pending || !allRecorded}>
              {pending ? "Finalizing…" : "Finalize this run"}
            </button>
            {!allRecorded ? (
              <p className="hint" style={{ marginTop: "var(--sp-2)" }}>
                Record every case first — a run finalizes whole or not at all.
              </p>
            ) : null}
            {/* Says where the half-finished run actually is, so nobody has to discover the
                boundary the hard way. It survives a reload and a trip to another screen;
                it does not survive closing the tab, and it is not on the server, because
                a per-case result cannot be written before the run is finalized. */}
            {recordedCount > 0 ? (
              <p className="hint" style={{ marginTop: "var(--sp-2)" }}>
                Results you record are kept in this browser tab until you finalize — they
                survive a reload, but not closing the tab.
              </p>
            ) : null}
          </div>
        </aside>
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

            {/* The spec being graded, above the grade and open by default — the task
                order is read the steps, then say what happened. A tester was expected to
                record a result here having last seen the steps on another screen. */}
            <div className="case-steps-dialog">
              <StepsDisclosure steps={openCase.steps} open />
            </div>

            {/* Three fixed options, so they are shown rather than hidden behind a menu:
                the result is the decision the whole dialog exists for, and a <select>
                made it two interactions and a scan of a dropdown. A radio group, not
                buttons — the outcomes are mutually exclusive, and arrow-key navigation,
                the group's name, and `required` all come from the platform. */}
            <fieldset
              className={
                state?.field === field("result") ? "outcome-set outcome-set-bad" : "outcome-set"
              }
            >
              <legend>Result</legend>
              <div className="outcome-choices">
                {OUTCOMES.map((outcome, index) => (
                  <label key={outcome} className="outcome-choice" data-outcome={outcome}>
                    <input
                      type="radio"
                      name="draft-result"
                      value={outcome}
                      checked={draft.result === outcome}
                      onChange={() => setOutcome(outcome)}
                      required
                      autoFocus={index === 0}
                      {...fieldProps(state, field("result"), CASE_FORM_ID)}
                    />
                    <span>{OUTCOME_LABEL[outcome]}</span>
                  </label>
                ))}
              </div>
            </fieldset>

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
