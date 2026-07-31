import Link from "next/link";
import type { TestCaseLifecycleState } from "@prisma/client";
import { TestCaseStateChip } from "./chips";

/**
 * The one way a list of test cases renders, so `/test-cases`, `/my-work/drafts` and
 * `/review` stay visually identical. Presentation only — which rows appear is the
 * calling page's question, and what a viewer may do with a row is the domain's.
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
  if (rows.length === 0) {
    return (
      <div className="card">
        <p className="muted" style={{ margin: 0 }}>{emptyText}</p>
      </div>
    );
  }
  return (
    <div className="card" style={{ padding: 0 }}>
      {rows.map((row) => (
        <div
          key={row.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--sp-4)",
            padding: "var(--sp-3) var(--sp-5)",
            borderBottom: "1px solid var(--line-soft)",
            flexWrap: "wrap"
          }}
        >
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
      ))}
    </div>
  );
}
