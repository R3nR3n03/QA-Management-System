"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { DefectLifecycleState, ExecutionLifecycleState, ExecutionOutcome } from "@prisma/client";
import { DefectStatusChip, ExecutionStateChip, OutcomeChip } from "./chips";

/**
 * The filterable record lists for executions and defects. Presentation only: which
 * rows exist is the server's answer; what the viewer may do with one is the
 * domain's. The filter matches ID, title/summary, state, and the tester's name.
 */

function Toolbar({
  value,
  onChange,
  placeholder,
  label
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  label: string;
}) {
  return (
    <div className="list-toolbar">
      <Search size={14} aria-hidden />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onChange("");
        }}
        placeholder={placeholder}
        aria-label={label}
      />
    </div>
  );
}

export type ExecutionRowData = {
  id: string;
  businessId: string;
  state: ExecutionLifecycleState;
  result: ExecutionOutcome | null;
  caseBusinessId: string;
  caseTitle: string;
  testerName: string;
};

export function ExecutionList({ rows }: { rows: ExecutionRowData[] }) {
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) =>
      `${row.businessId} ${row.caseBusinessId} ${row.caseTitle} ${row.testerName} ${row.state} ${row.result ?? ""}`
        .toLowerCase()
        .includes(needle)
    );
  }, [rows, query]);

  if (rows.length === 0) {
    return (
      <div className="card empty">
        <p>No executions yet. Plan one against an approved test case.</p>
      </div>
    );
  }

  return (
    <>
      {rows.length > 5 ? (
        <Toolbar
          value={query}
          onChange={setQuery}
          placeholder="Filter by ID, case, tester, or state…"
          label="Filter executions"
        />
      ) : null}
      <div className="card" style={{ padding: 0 }}>
        {visible.length === 0 ? (
          <div className="empty">
            <p>Nothing matches &ldquo;{query}&rdquo;.</p>
          </div>
        ) : (
          visible.map((row) => (
            <div key={row.id} className="list-row">
              <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", flexWrap: "wrap" }}>
                  <span className="bid">{row.businessId}</span>
                  <ExecutionStateChip state={row.state} />
                  {row.result ? <OutcomeChip outcome={row.result} /> : null}
                </div>
                <div style={{ fontWeight: 600, color: "var(--ink)", marginTop: 2 }}>{row.caseTitle}</div>
                <div className="muted">
                  <span className="bid">{row.caseBusinessId}</span>
                  {" · "}
                  {row.testerName}
                </div>
              </div>
              <Link href={`/executions/${row.id}`} style={{ fontSize: 14 }}>
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
        <Toolbar
          value={query}
          onChange={setQuery}
          placeholder="Filter by ID, summary, severity, or status…"
          label="Filter defects"
        />
      ) : null}
      <div className="card" style={{ padding: 0 }}>
        {visible.length === 0 ? (
          <div className="empty">
            <p>Nothing matches &ldquo;{query}&rdquo;.</p>
          </div>
        ) : (
          visible.map((defect) => (
            <div key={defect.id} className="list-row">
              <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", flexWrap: "wrap" }}>
                  <span className="bid">{defect.businessId}</span>
                  <DefectStatusChip status={defect.status} />
                </div>
                <div style={{ fontWeight: 600, color: "var(--ink)", marginTop: 2 }}>{defect.summary}</div>
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
