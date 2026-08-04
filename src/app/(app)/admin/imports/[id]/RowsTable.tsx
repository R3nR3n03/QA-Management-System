"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { LocalPager } from "@/ui/local-pager";
import { pageSlice } from "@/ui/paging";
import { OUTCOME_TONE } from "./outcome-tone";

/**
 * The row-level import report as a real table: homogeneous columns people scan and
 * compare, so it gets `<table>` semantics, client-side column sort, and the shared
 * `Pager` instead of dumping thousands of rows at once (the earlier binary "show
 * all" reveal is superseded — DESIGN-SYSTEM.md § Components). Presentation only —
 * the rows are already fetched and committed server-side; sorting and paging change
 * what is on screen, never what exists. Changing the sort resets to page 1.
 */

export type ImportRowData = {
  id: string;
  sourceSheet: string;
  sourceRow: number;
  outcome: string;
  errorCode: string | null;
  details: string | null;
};

type SortKey = "source" | "outcome" | "errorCode";

export function RowsTable({ rows }: { rows: ImportRowData[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("source");
  const [ascending, setAscending] = useState(true);
  const [page, setPage] = useState(1);

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

  const visible = pageSlice(sorted, page);

  const toggle = (key: SortKey) => {
    if (key === sortKey) setAscending((a) => !a);
    else {
      setSortKey(key);
      setAscending(true);
    }
    // A new order renumbers every page; stale page positions would mislead.
    setPage(1);
  };

  const header = (key: SortKey, label: string) => (
    // `scope="col"` rather than leaving the association to a UA heuristic — it is also
    // what makes `aria-sort` reliably interpreted.
    <th scope="col" aria-sort={sortKey === key ? (ascending ? "ascending" : "descending") : undefined}>
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
          {/* Without a name this announced as an unnamed 4-column table in a screen
              reader's table list. */}
          <caption className="sr-only">Import row report</caption>
          <thead>
            <tr>
              {header("source", "Sheet · row")}
              {header("outcome", "Outcome")}
              {header("errorCode", "Error code")}
              <th scope="col">Details</th>
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
      <LocalPager total={sorted.length} page={page} onPageChange={setPage} label="import row report" />
    </>
  );
}
