"use client";

import { useActionState, useState } from "react";
import { finalizeExecutionAction, type FormState } from "./actions";

/**
 * Finalizing is the only irreversible step a tester takes: a finalized execution
 * cannot return to In Progress (`docs/roles-workflows.md:39`), and the history row it
 * writes is append-only. So the form says so before the button, and the conditional
 * fields appear as soon as the result is chosen rather than after a rejected submit.
 *
 * The conditional rules are ALSO enforced in `src/domain/executions.ts`. Revealing a
 * field early is a courtesy, not the gate — a submit with JavaScript disabled still
 * hits the same server-side checks and gets the same message back.
 */
export function FinalizeForm({
  executionId,
  version,
  priorities,
  severities
}: {
  executionId: string;
  version: number;
  priorities: string[];
  severities: string[];
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    finalizeExecutionAction,
    null
  );
  const [outcome, setOutcome] = useState("");

  const bad = (field: string) => (state?.field === field ? "field field-bad" : "field");

  return (
    <form action={formAction}>
      <input type="hidden" name="executionId" value={executionId} />
      <input type="hidden" name="version" value={version} />

      {state ? (
        <div className={state.advisory ? "notice notice-advisory" : "notice"} role="alert">
          <strong>{state.title}</strong>
          <span>{state.detail}</span>
          {state.requestId ? <code>Reference {state.requestId}</code> : null}
        </div>
      ) : null}

      <label className={bad("result")}>
        <span>Result</span>
        <select
          name="result"
          required
          value={outcome}
          onChange={(e) => setOutcome(e.target.value)}
          disabled={pending}
        >
          <option value="" disabled>
            Choose a result…
          </option>
          <option value="PASS">Pass</option>
          <option value="FAIL">Fail</option>
          <option value="BLOCKED">Blocked</option>
        </select>
      </label>

      <label className={bad("actualResult")}>
        <span>What actually happened</span>
        <textarea name="actualResult" rows={3} required disabled={pending} />
        <span className="hint">
          This is the evidence the result rests on, so it is kept with the execution permanently.
        </span>
      </label>

      {outcome === "BLOCKED" ? (
        <label className={bad("blockReason")}>
          <span>What blocked it</span>
          <textarea name="blockReason" rows={2} disabled={pending} />
          <span className="hint">
            Say what stopped the run, so whoever picks it up knows where to start.
          </span>
        </label>
      ) : null}

      {outcome === "FAIL" ? (
        <fieldset
          style={{
            border: "1px solid var(--line)",
            borderRadius: "var(--radius)",
            padding: "var(--sp-4)",
            marginBottom: "var(--sp-4)"
          }}
        >
          <legend style={{ fontSize: 13, fontWeight: 620, padding: "0 var(--sp-2)" }}>
            Raise a defect
          </legend>
          <p className="muted" style={{ marginBottom: "var(--sp-3)" }}>
            A failed run needs a defect against this same test case. Fill this in to raise one now,
            or leave it blank if a defect already exists — you will be asked to pick it.
          </p>

          <label className={bad("createDefect.businessId")}>
            <span>Defect ID</span>
            <input name="defectBusinessId" placeholder="BUG-0001" disabled={pending} />
          </label>

          <label className={bad("createDefect.summary")}>
            <span>Summary</span>
            <input name="defectSummary" disabled={pending} />
          </label>

          <div style={{ display: "flex", gap: "var(--sp-3)" }}>
            <label className={bad("createDefect.priority")} style={{ flex: 1 }}>
              <span>Priority</span>
              <select name="defectPriority" disabled={pending} defaultValue="">
                <option value="">Not set yet</option>
                {priorities.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label className={bad("createDefect.severity")} style={{ flex: 1 }}>
              <span>Severity</span>
              <select name="defectSeverity" disabled={pending} defaultValue="">
                <option value="">Not set yet</option>
                {severities.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="muted" style={{ margin: 0 }}>
            Priority and severity can wait — they are required before the defect is triaged, not to
            raise it.
          </p>
        </fieldset>
      ) : null}

      <p className="why" style={{ marginBottom: "var(--sp-4)" }}>
        <strong>Finalizing can&rsquo;t be undone.</strong> A finalized execution never returns to In
        Progress, and this writes a permanent history entry. If the run needs repeating, that is a
        new execution against the same test case.
      </p>

      <button className="btn" type="submit" disabled={pending}>
        {pending ? "Finalizing…" : "Finalize this run"}
      </button>
    </form>
  );
}
