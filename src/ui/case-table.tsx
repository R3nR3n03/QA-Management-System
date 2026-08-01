"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { TestCaseLifecycleState } from "@prisma/client";
import { TestCaseStateChip } from "./chips";
import { FilterToolbar } from "./toolbar";

/**
 * The one way a list of test cases renders, so `/test-cases`, `/my-work/drafts` and
 * `/review` stay visually identical — now with a client-side filter over ID, title
 * and state. Filtering is presentation: which rows EXIST is still the server's
 * answer, and what a viewer may do with a row is the domain's.
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
          onChange={setQuery}
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
          visible.map((row) => (
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
      </div>
    </>
  );
}
