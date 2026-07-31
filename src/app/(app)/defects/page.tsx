import Link from "next/link";
import { listDefectsWithCase } from "@/domain/defects";
import { DefectStatusChip } from "@/ui/chips";
import { requireSession } from "@/ui/session";

export const dynamic = "force-dynamic";

export default async function DefectsPage() {
  await requireSession();
  const rows = await listDefectsWithCase();

  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", gap: "var(--sp-4)", flexWrap: "wrap" }}>
        <h1 style={{ flex: 1 }}>Defects</h1>
        <Link className="btn" href="/defects/new">
          New defect
        </Link>
      </div>
      <p className="muted" style={{ marginBottom: "var(--sp-4)" }}>
        {rows.length} defect{rows.length === 1 ? "" : "s"}. No state is ever skipped, and nothing is
        deleted — closure always records its evidence or rationale.
      </p>

      {rows.length === 0 ? (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>No defects recorded.</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          {rows.map((defect) => (
            <div
              key={defect.id}
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
                  <span className="bid">{defect.businessId}</span>
                  <DefectStatusChip status={defect.status} />
                </div>
                <div style={{ fontWeight: 600, color: "var(--ink)", marginTop: 2 }}>{defect.summary}</div>
                <div className="muted">
                  <span className="bid">{defect.testCase.businessId}</span>
                  {" · "}
                  {defect.priority || "no"} priority · {defect.severity || "no"} severity
                </div>
              </div>
              <Link href={`/defects/${defect.id}`} style={{ fontSize: 14 }}>
                View
              </Link>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
