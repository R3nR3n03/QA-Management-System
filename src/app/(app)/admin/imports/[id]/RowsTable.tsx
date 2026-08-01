"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { OUTCOME_TONE } from "./outcome-tone";

/**
 * The row-level import report as a real table: homogeneous columns people scan and
 * compare, so it gets `<table>` semantics, client-side column sort, and a reveal
 * control instead of dumping thousands of rows at once. Presentation only — the rows
 * are already fetched and committed server-side; sorting and revealing change what
 * is on screen, never what exists.
 */

export type ImportRowData = {
  id: string;
  sourceSheet: string;
  sourceRow: number;
  outcome: string;
  errorCode: string | null;
  details: string | null;
};

const PAGE = 50;

type SortKey = "source" | "outcome" | "errorCode";

export function RowsTable({ rows }: { rows: ImportRowData[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("source");
  const [ascending, setAscending] = useState(true);
  const [showAll, setShowAll] = useState(false);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "source") {
        cmp = a.sourceSheet.localeCompare(b.sourceSheet) || a.sourceRow - b.sourceRow;
      } else if (sortKey === "outcome") {
        cmp = a.outcome.localeCompare(b.outcome);
      } else {
        cmp = (a.errorCode ?? "").localeCompare(b.errorCode ?? "");
      }
      return ascending ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortKey, ascending]);

  const visible = showAll ? sorted : sorted.slice(0, PAGE);

  const toggle = (key: SortKey) => {
    if (key === sortKey) setAscending((a) => !a);
    else {
      setSortKey(key);
      setAscending(true);
    }
  };

  const header = (key: SortKey, label: string) => (
    <th aria-sort={sortKey === key ? (ascending ? "ascending" : "descending") : undefined}>
      <button type="button" onClick={() => toggle(key)}>
        {label}
        {sortKey === key ? (
          ascending ? (
            <ChevronUp size={12} aria-hidden />
          ) : (
            <ChevronDown size={12} aria-hidden />
          )
        ) : null}
        <span className="sr-only">
          {sortKey === key ? (ascending ? " (sorted ascending)" : " (sorted descending)") : " (sort)"}
        </span>
      </button>
    </th>
  );

  return (
    <>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              {header("source", "Sheet · row")}
              {header("outcome", "Outcome")}
              {header("errorCode", "Error code")}
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.id}>
                <td style={{ whiteSpace: "nowrap" }}>
                  {row.sourceSheet} · {row.sourceRow}
                </td>
                <td>
                  <span className={OUTCOME_TONE[row.outcome] ?? "state"}>{row.outcome}</span>
                </td>
                <td>{row.errorCode ? <span className="bid">{row.errorCode}</span> : null}</td>
                <td>{row.details ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length > PAGE ? (
        <p className="muted" style={{ padding: "var(--sp-3) var(--sp-4)", margin: 0 }}>
          Showing {visible.length} of {sorted.length} rows.{" "}
          {!showAll ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowAll(true)}>
              Show all {sorted.length}
            </button>
          ) : (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowAll(false)}>
              Show first {PAGE}
            </button>
          )}
        </p>
      ) : null}
    </>
  );
}
