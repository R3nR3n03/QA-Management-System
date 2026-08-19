"use client";

import { useActionState, useState } from "react";
import { FormNotice } from "@/ui/notice";
import type { FormState } from "@/ui/action";
import { fieldClass, fieldProps, noticeId } from "@/ui/form";
import { EXECUTION_PURPOSE_MAX_LENGTH } from "@/lib/field-limits";
import { CasePicker, type PlanProduct } from "@/ui/case-picker";
import type { PlanCandidate } from "@/ui/plan-grouping";
import { createExecutionAction } from "./actions";

const FORM_ID = "plan-execution";

export type { PlanProduct };

export type PlanTester = {
  id: string;
  displayName: string;
  /** Unfinished runs already assigned to this person. */
  openRuns: number;
};

/**
 * Planning is a small decision: which approved cases, who runs them. The execution ID
 * is allocated by the server (`docs/business-rules-and-validation.md:11`), so nobody
 * types one. One execution may cover one or more Approved cases selected together
 * (`docs/business-rules-and-validation.md:27`); results are recorded per case at
 * finalize. Only Approved cases are offered because only they can be executed
 * (`docs/data-model.md:47`) — and the domain re-checks that whichever caller asks.
 *
 * ## The picker is not this form's
 *
 * Choosing cases is `CasePicker` in `src/ui/`, shared with the naming-contract screen.
 * Its grouping, filtering, open/closed and render-cap rules live in
 * `src/ui/plan-grouping.ts`, which is where their combinations are tested. What stays
 * here is the selection itself, because this form is what submits it and what its
 * button is enabled by — and the three fields around it that only planning has.
 *
 * Nothing here validates. Non-empty and no-duplicates are enforced in `createExecution`;
 * a disabled submit is a courtesy.
 */
export function PlanForm({
  cases,
  testers,
  products = [],
  preselect = [],
  unavailable = 0,
  defaultPurpose = ""
}: {
  cases: PlanCandidate[];
  testers: PlanTester[];
  /** Products that actually have an Approved case; omit to leave the filter off. */
  products?: PlanProduct[];
  /** Case ids to start selected — a rerun arriving from a finalized run. */
  preselect?: string[];
  /** Requested cases that are no longer offerable, reported rather than dropped. */
  unavailable?: number;
  /**
   * The source run's purpose when this is a rerun, so the planner edits a sentence rather
   * than writing one. A preselection like `preselect`, never an instruction: it is a plain
   * `defaultValue`, so typing over it is the whole of the escape hatch.
   */
  defaultPurpose?: string;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(createExecutionAction, null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(preselect));
  const bad = (field: string) => fieldClass(state, field);

  return (
    <form action={formAction}>
      <FormNotice state={state} id={noticeId(FORM_ID)} />

      {unavailable > 0 ? (
        <div className="notice notice-advisory" role="status">
          <strong>
            {unavailable} case{unavailable === 1 ? "" : "s"} could not be carried over
          </strong>
          <span>
            {unavailable === 1 ? "It is" : "They are"} no longer Approved — a revised or retired
            case cannot be executed. Everything else from that run is selected below.
          </span>
        </div>
      ) : null}

      {/*
        First, because it is the question the rest of the form answers the details of: what
        is this run for, then which cases, then who. It is also the field every row of
        `/executions` and `/my-work` is headed with, so it is not an afterthought at the
        bottom. `maxLength` stops the typing at the documented cap rather than letting
        someone write a paragraph and lose it on submit — the rule itself is the domain's,
        which refuses a blank or over-long purpose with 422 ID_INVALID.
      */}
      <label className={bad("purpose")}>
        <span>Purpose</span>
        <input
          name="purpose"
          type="text"
          required
          maxLength={EXECUTION_PURPOSE_MAX_LENGTH}
          defaultValue={defaultPurpose}
          placeholder="Sprint 24 regression, Chrome"
          autoComplete="off"
          disabled={pending}
          {...fieldProps(state, "purpose", FORM_ID)}
        />
        <span className="hint">
          One line saying what this run checks. It is what the run is listed under in the
          executions list and in the tester&rsquo;s queue, so make it tell them apart —
          &ldquo;Sprint 24 regression, Chrome&rdquo;, not &ldquo;Run 3&rdquo;.
        </span>
      </label>

      {/*
        A rejected GROUP marks the section, not the controls inside it. `bad()` returns
        the FIELD classes — meant for a `<label className="field">` — and on a fieldset
        `.field select { width: 100% }` stretched the product filter while
        `.field-bad select { border-color: var(--fail) }` turned it red. So rejecting
        the case selection pointed the error at a dropdown that had nothing to do with
        it. `outcome-set-bad` in FinalizeForm is the same pattern done correctly.
      */}
      <fieldset className={`form-section${state?.field === "testCaseIds" ? " form-section-bad" : ""}`}>
        <legend>Approved test cases</legend>
        <div className="stack">
          <CasePicker
            cases={cases}
            selected={selected}
            onSelectedChange={setSelected}
            name="testCaseIds"
            products={products}
            disabled={pending}
            invalid={state?.field === "testCaseIds"}
            describedBy={noticeId(FORM_ID)}
          />

          <span className="hint">
            Open a feature to pick cases, or tick the feature to take all of them. The run covers
            them together, and each gets its own result at finalize. The execution ID is assigned
            automatically.
          </span>
        </div>
      </fieldset>

      <label className={bad("testerId")}>
        <span>Assigned tester</span>
        <select name="testerId" required defaultValue="" disabled={pending} {...fieldProps(state, "testerId", FORM_ID)}>
          <option value="" disabled>
            Choose…
          </option>
          {testers.map((tester) => (
            <option key={tester.id} value={tester.id}>
              {tester.displayName} · {tester.openRuns} open
            </option>
          ))}
        </select>
        <span className="hint">
          The run appears in their work queue; only they (or a higher role) can start it. The
          count is how many unfinished runs each person already has — a workload, not a limit.
        </span>
      </label>

      {/*
        Optional, and the only point at which it can be set: the key is part of the record
        once the run leaves Planned, the same rule that freezes the tester
        (`docs/roles-workflows.md`). Not `type="url"` or a pattern attribute — the format is
        a documented business rule and belongs to the domain, which refuses a malformed key
        with 422 ID_INVALID and reports it through this form's notice like every other rule.
      */}
      <label className={bad("jiraIssueKey")}>
        <span>Jira issue key (optional)</span>
        <input
          name="jiraIssueKey"
          type="text"
          placeholder="PROJ-123"
          autoComplete="off"
          disabled={pending}
          {...fieldProps(state, "jiraIssueKey", FORM_ID)}
        />
        <span className="hint">
          The Jira task this run tests. When every run against the same key is finalized and
          all of them pass, QAMS moves that issue to Done. Leave it blank if this run has no
          Jira task — a failed or blocked run never moves the issue.
        </span>
      </label>

      <button className="btn" type="submit" disabled={pending || selected.size === 0}>
        {pending
          ? "Planning…"
          : selected.size === 0
            ? "Plan execution"
            : `Plan execution covering ${selected.size} case${selected.size === 1 ? "" : "s"}`}
      </button>
      {selected.size === 0 ? (
        <p className="hint" style={{ marginTop: "var(--sp-2)" }}>
          Pick at least one approved case to cover.
        </p>
      ) : null}
    </form>
  );
}
