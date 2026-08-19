"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { CasePicker, type PlanProduct } from "@/ui/case-picker";
import type { PlanCandidate } from "@/ui/plan-grouping";

/**
 * Pick the cases, get the file.
 *
 * ## Why this posts instead of linking
 *
 * The obvious shape is a `GET` with the ids in the query string, like the sample results
 * file download. It does not survive contact with a real catalogue: three hundred cases as
 * UUIDs is around eleven thousand characters, past what browsers and proxies reliably carry
 * — and it fails by TRUNCATION, so the contract would quietly name fewer cases than the
 * person selected. A `POST` has no such ceiling.
 *
 * It is a plain HTML form with a plain submit, not a server action: the response is a file,
 * and the browser downloads it and leaves the page where it is. Nothing here needs
 * hydration except the picker itself.
 *
 * ## Nothing validates here
 *
 * `buildNamingContract` refuses an empty selection. The disabled button is a courtesy, the
 * same relationship `PlanForm` has with `createExecution`.
 */
/** One run offered as a starting point, with the cases it covers that are still offerable. */
export type ContractRun = {
  id: string;
  businessId: string;
  purpose: string;
  /** Already intersected against the Approved set by the page. */
  caseIds: string[];
  /** How many of its cases the intersection dropped. */
  unavailable: number;
};

export function ContractForm({
  cases,
  products,
  preselect,
  unavailable,
  runs = [],
  runsCapped = false
}: {
  cases: PlanCandidate[];
  products: PlanProduct[];
  /** Case ids to start selected — arriving from an execution. */
  preselect: string[];
  /** Requested cases that are no longer offerable, reported rather than dropped. */
  unavailable: number;
  /** Recent runs offered as a starting point; omit to leave the shortcut off. */
  runs?: ContractRun[];
  /** Whether that list was cut at the limit, which the hint then says out loud. */
  runsCapped?: boolean;
}) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(preselect));
  const [runId, setRunId] = useState("");

  const chosenRun = runs.find((run) => run.id === runId);
  /*
   * Whichever intersection is currently the one being reported. A run picked from the
   * dropdown supersedes whatever `?cases=` arrived with, because its selection has replaced
   * that one on screen — reporting the old count against the new selection would name a
   * number the reader cannot account for.
   */
  const dropped = chosenRun ? chosenRun.unavailable : unavailable;

  /*
   * Starting from a run REPLACES the selection rather than adding to it, which is what
   * "start from" says on the control. The picker's own Clear selection is the way back to
   * building one by hand.
   */
  const startFromRun = (nextId: string) => {
    setRunId(nextId);
    const run = runs.find((one) => one.id === nextId);
    setSelected(new Set(run ? run.caseIds : []));
  };

  return (
    <form method="post" action="/admin/checks/naming-contract/download">
      {dropped > 0 ? (
        <div className="notice notice-advisory" role="status">
          <strong>
            {dropped} case{dropped === 1 ? "" : "s"} could not be carried over
          </strong>
          <span>
            {dropped === 1 ? "It is" : "They are"} no longer Approved — a revised or retired
            case does not belong in a contract someone is about to write specs against.
            Everything else from that run is selected below.
          </span>
        </div>
      ) : null}

      <fieldset className="form-section">
        <legend>Approved test cases</legend>
        <div className="stack">
          {runs.length > 0 ? (
            /* A run is a bundle of cases somebody already assembled, so it is the fastest
               way to a selection — but it stays a starting point. Local state, not the URL:
               the whole candidate set is already in the browser, so choosing a run is not a
               navigation and does not discard what is on screen. */
            <>
              {/* The hint sits OUTSIDE the label, so the select's accessible name is its
                  label rather than its label plus a sentence — the shape
                  `DisplayPreferencesForm` uses for the same reason. */}
              <label className="field">
                <span>Start from a run (optional)</span>
                <select
                  className="select-filter"
                  value={runId}
                  onChange={(event) => startFromRun(event.target.value)}
                >
                  <option value="">Choose cases by hand</option>
                  {runs.map((run) => (
                    <option key={run.id} value={run.id}>
                      {run.purpose} · {run.businessId} · {run.caseIds.length} case
                      {run.caseIds.length === 1 ? "" : "s"}
                    </option>
                  ))}
                </select>
              </label>
              <span className="hint">
                Selects the cases that run covers, replacing whatever is selected now — then
                edit it below. A run is offered only while at least one of its cases is still
                Approved.
                {runsCapped ? " The 50 most recent runs are listed." : ""}
              </span>
            </>
          ) : null}

          <CasePicker
            cases={cases}
            selected={selected}
            onSelectedChange={setSelected}
            name="cases"
            products={products}
          />

          <span className="hint">
            Open a feature to pick cases, or tick the feature to take all of them. Only Approved
            cases are offered: a Draft may still change, and a Retired case should not be
            automated.
          </span>
        </div>
      </fieldset>

      <button className="btn" type="submit" disabled={selected.size === 0}>
        <Download size={14} aria-hidden />{" "}
        {selected.size === 0
          ? "Download contract"
          : `Download contract for ${selected.size} case${selected.size === 1 ? "" : "s"}`}
      </button>
      {selected.size === 0 ? (
        <p className="hint" style={{ marginTop: "var(--sp-2)" }}>
          Pick at least one approved case to name.
        </p>
      ) : null}
    </form>
  );
}
