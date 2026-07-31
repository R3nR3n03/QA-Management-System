import { dashboardSnapshot } from "@/domain/traceability";
import { requireSession } from "@/ui/session";
import { OutcomeChip } from "@/ui/chips";
import { ExecutionOutcome } from "@prisma/client";

export const dynamic = "force-dynamic";

/**
 * The dashboard renders every metric WITH its stated filters, numerator,
 * denominator and as-of time — `business-rules-and-validation.md:37` requires a
 * metric to state them before it is shown, so the statement is part of the metric's
 * presentation, not a tooltip. No thresholds, no red/green judgement: the knowledge
 * base defines none (`:38`), so the numbers are reported, never graded.
 */
export default async function DashboardPage() {
  await requireSession();
  const snapshot = await dashboardSnapshot();

  return (
    <>
      <h1>Dashboard</h1>
      <p className="muted">As of {snapshot.asOfUtc} (UTC). Counts come from persisted records, not imported spreadsheet formulas.</p>

      <div style={{ display: "flex", gap: "var(--sp-4)", flexWrap: "wrap", marginBottom: "var(--sp-6)" }}>
        <div className="card" style={{ flex: "1 1 200px" }}>
          <div className="muted">Products (non-retired)</div>
          <div style={{ fontSize: 32, fontWeight: 640, color: "var(--ink)" }}>{snapshot.products}</div>
        </div>
        <div className="card" style={{ flex: "1 1 200px" }}>
          <div className="muted">Test cases (non-retired)</div>
          <div style={{ fontSize: 32, fontWeight: 640, color: "var(--ink)" }}>{snapshot.testCases}</div>
        </div>
      </div>

      <h2>Finalized executions by result</h2>
      <MetricStatement metric={snapshot.executionFinalizedByResult} />
      <div className="card" style={{ padding: 0, marginBottom: "var(--sp-6)" }}>
        {snapshot.executionFinalizedByResult.counts.length === 0 ? (
          <p className="muted" style={{ padding: "var(--sp-4) var(--sp-5)", margin: 0 }}>
            No finalized executions yet.
          </p>
        ) : (
          snapshot.executionFinalizedByResult.counts.map((row) => (
            <div
              key={row.result ?? "none"}
              style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)", padding: "var(--sp-3) var(--sp-5)", borderBottom: "1px solid var(--line-soft)" }}
            >
              {row.result ? <OutcomeChip outcome={row.result as ExecutionOutcome} /> : <span className="state">No result</span>}
              <span style={{ fontWeight: 620 }}>{row._count}</span>
              <span className="muted">of {snapshot.executionFinalizedByResult.denominatorCount} finalized</span>
            </div>
          ))
        )}
      </div>

      <h2>Open defects by severity</h2>
      <MetricStatement metric={snapshot.openDefectsBySeverity} />
      <div className="card" style={{ padding: 0 }}>
        {snapshot.openDefectsBySeverity.counts.length === 0 ? (
          <p className="muted" style={{ padding: "var(--sp-4) var(--sp-5)", margin: 0 }}>
            No open defects.
          </p>
        ) : (
          snapshot.openDefectsBySeverity.counts.map((row) => (
            <div
              key={row.severity || "unset"}
              style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)", padding: "var(--sp-3) var(--sp-5)", borderBottom: "1px solid var(--line-soft)" }}
            >
              <span style={{ fontWeight: 620, minWidth: 90 }}>{row.severity || "Not set"}</span>
              <span style={{ fontWeight: 620 }}>{row._count}</span>
              <span className="muted">of {snapshot.openDefectsBySeverity.denominatorCount} open</span>
            </div>
          ))
        )}
      </div>
    </>
  );
}

function MetricStatement({
  metric
}: {
  metric: { filters: string; numerator: string; denominator: string; asOfUtc: string };
}) {
  return (
    <p className="muted" style={{ marginBottom: "var(--sp-3)" }}>
      Filters: {metric.filters}. Numerator: {metric.numerator}. Denominator: {metric.denominator}. As
      of {metric.asOfUtc}.
    </p>
  );
}
