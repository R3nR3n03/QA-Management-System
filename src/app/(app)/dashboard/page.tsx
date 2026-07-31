import Link from "next/link";
import { ExecutionOutcome, QamsRole } from "@prisma/client";
import { dashboardSnapshot } from "@/domain/traceability";
import { requireSession } from "@/ui/session";
import { OutcomeChip } from "@/ui/chips";

export const dynamic = "force-dynamic";

/**
 * The dashboard: KPIs, then the two documented metric groups as labeled horizontal
 * bars. `business-rules-and-validation.md:37` requires each metric to state its
 * filters, numerator, denominator, and as-of time before being shown, so the
 * statement renders with the chart — and `:38` forbids grading against thresholds
 * the knowledge base does not define, so nothing here is judged, only reported.
 *
 * Chart discipline (dataviz): identity is carried by each row's text label and
 * chip, never by fill color alone; the result bars use the app's reserved status
 * palette; the severity bars use one neutral hue because severity values are
 * QA-Lead-configurable strings, not a fixed series.
 */

const OUTCOME_FILL: Record<string, string> = {
  PASS: "var(--pass)",
  FAIL: "var(--fail)",
  BLOCKED: "var(--blocked)"
};

function BarRows({
  rows
}: {
  rows: Array<{ key: string; head: React.ReactNode; count: number; fill: string }>;
}) {
  const max = Math.max(...rows.map((row) => row.count), 1);
  return (
    <>
      {rows.map((row) => (
        <div key={row.key} className="bar-row">
          <div className="bar-head">{row.head}</div>
          <div className="bar-track">
            <div
              className="bar-fill"
              style={{ width: `${Math.max((row.count / max) * 100, 2)}%`, background: row.fill }}
            />
          </div>
          <div className="bar-count">{row.count}</div>
        </div>
      ))}
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

export default async function DashboardPage() {
  const auth = await requireSession();
  const snapshot = await dashboardSnapshot();
  const isLead = auth.role === QamsRole.QA_LEAD;
  const mayAuthor = auth.role !== QamsRole.QA_TESTER;

  const executions = snapshot.executionFinalizedByResult;
  const defects = snapshot.openDefectsBySeverity;

  return (
    <>
      <h1>Dashboard</h1>
      <p className="muted" style={{ marginBottom: "var(--sp-4)" }}>
        As of {snapshot.asOfUtc} (UTC). Counts come from persisted records, not imported spreadsheet
        formulas, and nothing here is graded — the knowledge base defines no thresholds.
      </p>

      <div className="kpi-grid">
        <div className="kpi">
          <div className="kpi-label">Products</div>
          <div className="kpi-value">{snapshot.products}</div>
          <div className="kpi-hint">non-retired</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Test cases</div>
          <div className="kpi-value">{snapshot.testCases}</div>
          <div className="kpi-hint">non-retired</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Finalized executions</div>
          <div className="kpi-value">{executions.denominatorCount}</div>
          <div className="kpi-hint">all time</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Open defects</div>
          <div className="kpi-value">{defects.denominatorCount}</div>
          <div className="kpi-hint">not closed</div>
        </div>
      </div>

      <div className="quick-actions">
        <Link className="btn btn-secondary" href="/executions/new">
          Plan an execution
        </Link>
        {mayAuthor ? (
          <Link className="btn btn-secondary" href="/test-cases/new">
            Draft a test case
          </Link>
        ) : null}
        <Link className="btn btn-secondary" href="/defects/new">
          Raise a defect
        </Link>
        {isLead ? (
          <Link className="btn btn-secondary" href="/release-readiness">
            Release readiness
          </Link>
        ) : null}
      </div>

      <h2>Finalized executions by result</h2>
      <MetricStatement metric={executions} />
      <div className="card" style={{ padding: "var(--sp-2) 0", marginBottom: "var(--sp-6)" }}>
        {executions.counts.length === 0 ? (
          <div className="empty">
            <p>No finalized executions yet — results land here as runs are finalized.</p>
            <Link className="btn btn-ghost" href="/executions">
              Go to executions
            </Link>
          </div>
        ) : (
          <BarRows
            rows={executions.counts.map((row) => ({
              key: row.result ?? "none",
              head: row.result ? (
                <OutcomeChip outcome={row.result as ExecutionOutcome} />
              ) : (
                <span className="state">No result</span>
              ),
              count: row._count,
              fill: OUTCOME_FILL[row.result ?? ""] ?? "var(--accent)"
            }))}
          />
        )}
      </div>

      <h2>Open defects by severity</h2>
      <MetricStatement metric={defects} />
      <div className="card" style={{ padding: "var(--sp-2) 0" }}>
        {defects.counts.length === 0 ? (
          <div className="empty">
            <p>No open defects. New and reopened defects appear here by severity.</p>
          </div>
        ) : (
          <BarRows
            rows={defects.counts.map((row) => ({
              key: row.severity || "unset",
              head: <span style={{ fontWeight: 620, fontSize: 13.5 }}>{row.severity || "Not set"}</span>,
              count: row._count,
              fill: "var(--accent)"
            }))}
          />
        )}
      </div>
    </>
  );
}
