"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { TestCaseLifecycleState } from "@prisma/client";
import { TestCaseStateChip } from "./chips";

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
        <div className="list-toolbar">
          <Search size={14} aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery("");
            }}
            placeholder="Filter by ID, title, or state…"
            aria-label="Filter test cases"
          />
        </div>
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
                  <TestCaseStateChip state={row.lifecycleState} />
                </div>
                <div style={{ fontWeight: 600, color: "var(--ink)", marginTop: 2 }}>{row.title}</div>
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
