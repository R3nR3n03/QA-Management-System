"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { DefectLifecycleState, ExecutionLifecycleState, ExecutionOutcome } from "@prisma/client";
import { DefectStatusChip, ExecutionStateChip, OutcomeChip } from "./chips";
import { FilterToolbar } from "./toolbar";

/**
 * The filterable record lists for executions and defects. Presentation only: which
 * rows exist is the server's answer; what the viewer may do with one is the
 * domain's. The filter matches ID, title/summary, state, and the tester's name.
 */

export type ExecutionRowData = {
  id: string;
  businessId: string;
  state: ExecutionLifecycleState;
  result: ExecutionOutcome | null;
  /** Business IDs of every covered case, in coverage order. */
  caseBusinessIds: string[];
  /** The first covered case's title. */
  caseTitle: string;
  testerName: string;
};

const EXECUTION_STATE_FILTERS: Array<{ value: "ALL" | ExecutionLifecycleState; label: string }> = [
  { value: "ALL", label: "All" },
  { value: "PLANNED", label: "Planned" },
  { value: "IN_PROGRESS", label: "In Progress" },
  { value: "FINALIZED", label: "Finalized" }
];

export function ExecutionList({ rows }: { rows: ExecutionRowData[] }) {
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<"ALL" | ExecutionLifecycleState>("ALL");
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (stateFilter !== "ALL" && row.state !== stateFilter) return false;
      if (!needle) return true;
      return `${row.businessId} ${row.caseBusinessIds.join(" ")} ${row.caseTitle} ${row.testerName} ${row.state} ${row.result ?? ""}`
        .toLowerCase()
        .includes(needle);
    });
  }, [rows, query, stateFilter]);

  if (rows.length === 0) {
    return (
      <div className="card empty">
        <p>No executions yet. Plan one against an approved test case.</p>
      </div>
    );
  }

  return (
    <>
      <div className="row">
        {rows.length > 5 ? (
          <FilterToolbar
            value={query}
            onChange={setQuery}
            placeholder="Filter by ID, case, tester, or state…"
            label="Filter executions"
          />
        ) : null}
        <div className="cluster" role="group" aria-label="Filter by lifecycle state">
          {EXECUTION_STATE_FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={option.value === stateFilter ? "btn btn-sm" : "btn btn-secondary btn-sm"}
              aria-pressed={option.value === stateFilter}
              onClick={() => setStateFilter(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div className="card card-flush">
        {visible.length === 0 ? (
          <div className="empty">
            <p>No execution matches the current filters.</p>
          </div>
        ) : (
          visible.map((row) => (
            <div key={row.id} className="list-row">
              <div className="row-main">
                <div className="cluster">
                  <span className="bid">{row.businessId}</span>
                  <ExecutionStateChip state={row.state} />
                  {row.result ? <OutcomeChip outcome={row.result} /> : null}
                  {row.caseBusinessIds.length > 1 ? (
                    <span className="state">{row.caseBusinessIds.length} cases</span>
                  ) : null}
                </div>
                <div className="row-title">{row.caseTitle}</div>
                <div className="muted">
                  <span className="bid">{row.caseBusinessIds[0]}</span>
                  {row.caseBusinessIds.length > 1 ? ` +${row.caseBusinessIds.length - 1} more` : ""}
                  {" · "}
                  {row.testerName}
                </div>
              </div>
              <Link className="btn btn-secondary btn-sm" href={`/executions/${row.id}`}>
                View
              </Link>
            </div>
          ))
        )}
      </div>
    </>
  );
}

export type DefectRowData = {
  id: string;
  businessId: string;
  status: DefectLifecycleState;
  summary: string;
  priority: string;
  severity: string;
  caseBusinessId: string;
};

export function DefectList({ rows }: { rows: DefectRowData[] }) {
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) =>
      `${row.businessId} ${row.caseBusinessId} ${row.summary} ${row.status} ${row.severity} ${row.priority}`
        .toLowerCase()
        .includes(needle)
    );
  }, [rows, query]);

  if (rows.length === 0) {
    return (
      <div className="card empty">
        <p>No defects recorded.</p>
      </div>
    );
  }

  return (
    <>
      {rows.length > 5 ? (
        <FilterToolbar
          value={query}
          onChange={setQuery}
          placeholder="Filter by ID, summary, severity, or status…"
          label="Filter defects"
        />
      ) : null}
      <div className="card card-flush">
        {visible.length === 0 ? (
          <div className="empty">
            <p>Nothing matches &ldquo;{query}&rdquo;.</p>
          </div>
        ) : (
          visible.map((defect) => (
            <div key={defect.id} className="list-row">
              <div className="row-main">
                <div className="cluster">
                  <span className="bid">{defect.businessId}</span>
                  <DefectStatusChip status={defect.status} />
                </div>
                <div className="row-title">{defect.summary}</div>
                <div className="muted">
                  <span className="bid">{defect.caseBusinessId}</span>
                  {" · "}
                  {defect.priority || "no"} priority · {defect.severity || "no"} severity
                </div>
              </div>
              <Link href={`/defects/${defect.id}`} style={{ fontSize: 14 }}>
                View
              </Link>
            </div>
          ))
        )}
      </div>
    </>
  );
}
