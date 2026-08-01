"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { TestCaseLifecycleState } from "@prisma/client";
import { TestCaseStateChip } from "./chips";
import { Pager } from "./pager";
import { pageSlice } from "./paging";
import { FilterToolbar } from "./toolbar";

/**
 * The one way a list of test cases renders, so `/test-cases`, `/my-work/drafts` and
 * `/review` stay visually identical — with a client-side filter over ID, title and
 * state, and the shared `Pager` over the filtered rows (page resets when the filter
 * changes). Filtering and paging are presentation: which rows EXIST is still the
 * server's answer, and what a viewer may do with a row is the domain's.
 */
export type CaseRow = {
  id: string;
  businessId: string;
  title: string;
  lifecycleState: TestCaseLifecycleState;
  priority: string;
  severity: string;
};

export function CaseTable({ rows, emptyText }: { rows: CaseRow[]; emptyText: string }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) =>
      `${row.businessId} ${row.title} ${row.lifecycleState}`.toLowerCase().includes(needle)
    );
  }, [rows, query]);

  if (rows.length === 0) {
    return (
      <div className="card empty">
        <p>{emptyText}</p>
      </div>
    );
  }

  return (
    <>
      {rows.length > 5 ? (
        <FilterToolbar
          value={query}
          onChange={(next) => {
            setQuery(next);
            setPage(1);
          }}
          placeholder="Filter by ID, title, or state…"
          label="Filter test cases"
        />
      ) : null}

      <div className="card card-flush">
        {visible.length === 0 ? (
          <div className="empty">
            <p>Nothing matches &ldquo;{query}&rdquo;.</p>
          </div>
        ) : (
          pageSlice(visible, page).map((row) => (
            <div key={row.id} className="list-row">
              <div className="row-main">
                <div className="cluster">
                  <span className="bid">{row.businessId}</span>
                  <TestCaseStateChip state={row.lifecycleState} />
                </div>
                <div className="row-title">{row.title}</div>
                <div className="muted">
                  {row.priority || "no"} priority · {row.severity || "no"} severity
                </div>
              </div>
              <Link href={`/test-cases/${row.id}`} style={{ fontSize: 14 }}>
                View
              </Link>
            </div>
          ))
        )}
        <Pager total={visible.length} page={page} onPageChange={setPage} label="test cases" />
      </div>
    </>
  );
}
