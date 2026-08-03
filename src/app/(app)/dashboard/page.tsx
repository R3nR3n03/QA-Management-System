import Link from "next/link";
import {
  DefectLifecycleState,
  ExecutionLifecycleState,
  ExecutionOutcome,
  QamsRole,
  TestCaseLifecycleState
} from "@prisma/client";
import { dashboardSnapshot } from "@/domain/traceability";
import { requireSession } from "@/ui/session";
import {
  DefectStatusChip,
  ExecutionStateChip,
  OutcomeChip,
  TestCaseStateChip
} from "@/ui/chips";

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

/**
 * Finalized executions per week, as columns — the one chart here whose job is
 * change-over-time rather than magnitude across categories.
 *
 * One series, so no legend: the heading names it. Empty weeks are rendered as empty
 * slots rather than skipped, because a chart that closes its gaps turns a fortnight of
 * no testing into an unbroken run of activity. Only the first and last week are labeled
 * on the axis — a number under every column is noise — and the full figures are in the
 * screen-reader listing beneath, which doubles as the table view.
 *
 * A count, never a rate. `business-rules-and-validation.md:39` defines no target, so
 * there is no line to draw across this and nothing here is graded.
 */
function WeekColumns({ weeks }: { weeks: Array<{ weekStartUtc: string; count: number }> }) {
  const max = Math.max(...weeks.map((week) => week.count), 1);
  const shortDate = (iso: string) => iso.slice(5).replace("-", "/");

  return (
    <div className="week-chart">
      <div className="week-cols">
        {weeks.map((week) => (
          <div key={week.weekStartUtc} className="week-col">
            <div
              className="week-bar"
              // Native hover: the figure without shipping a client component for it.
              title={`Week of ${week.weekStartUtc} (UTC): ${week.count} finalized`}
              style={{ height: `${(week.count / max) * 100}%` }}
              data-zero={week.count === 0 ? "" : undefined}
            />
          </div>
        ))}
      </div>
      <div className="week-axis">
        <span>{shortDate(weeks[0]?.weekStartUtc ?? "")}</span>
        <span>{shortDate(weeks[weeks.length - 1]?.weekStartUtc ?? "")}</span>
      </div>
    </div>
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
  const caseStates = snapshot.testCasesByLifecycleState;
  const executionStates = snapshot.executionsByState;
  const defectStates = snapshot.defectsByStatus;
  const linkage = snapshot.requirementTraceLinkage;
  const trend = snapshot.finalizedExecutionsByWeek;

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
      <div className="card card-flush" style={{ marginBottom: "var(--sp-6)" }}>
        {executions.counts.length === 0 ? (
          <div className="empty">
            <p>No finalized executions yet — results land here as runs are finalized.</p>
            <Link className="btn btn-ghost" href="/executions">
              Go to executions
            </Link>
          </div>
        ) : (
          <>
            <p className="sr-only">
              Finalized executions by result:{" "}
              {executions.counts.map((row) => `${row.result ?? "No result"} ${row._count}`).join(", ")}.
            </p>
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
          </>
        )}
      </div>

      <h2>Open defects by severity</h2>
      <MetricStatement metric={defects} />
      <div className="card card-flush">
        {defects.counts.length === 0 ? (
          <div className="empty">
            <p>No open defects. New and reopened defects appear here by severity.</p>
          </div>
        ) : (
          <>
            <p className="sr-only">
              Open defects by severity:{" "}
              {defects.counts.map((row) => `${row.severity || "Not set"} ${row._count}`).join(", ")}.
            </p>
            <BarRows
              rows={defects.counts.map((row) => ({
                key: row.severity || "unset",
                head: <span style={{ fontWeight: 620, fontSize: 13.5 }}>{row.severity || "Not set"}</span>,
                count: row._count,
                fill: "var(--accent)"
              }))}
            />
          </>
        )}
      </div>

      <h2 style={{ marginTop: "var(--sp-6)" }}>Finalized executions per week</h2>
      <MetricStatement metric={trend} />
      <div className="card" style={{ marginBottom: "var(--sp-6)" }}>
        {trend.denominatorCount === 0 ? (
          <div className="empty">
            <p>Nothing finalized in the last 12 weeks.</p>
          </div>
        ) : (
          <>
            <p className="sr-only">
              Finalized executions per week:{" "}
              {trend.counts.map((week) => `week of ${week.weekStartUtc}, ${week.count}`).join("; ")}.
            </p>
            <WeekColumns weeks={trend.counts} />
          </>
        )}
      </div>

      <h2>Test cases by lifecycle state</h2>
      <MetricStatement metric={caseStates} />
      <div className="card card-flush" style={{ marginBottom: "var(--sp-6)" }}>
        {caseStates.counts.length === 0 ? (
          <div className="empty">
            <p>No test cases yet.</p>
          </div>
        ) : (
          <>
            <p className="sr-only">
              Test cases by lifecycle state:{" "}
              {caseStates.counts.map((row) => `${row.lifecycleState} ${row._count}`).join(", ")}.
            </p>
            <BarRows
              rows={caseStates.counts.map((row) => ({
                key: row.lifecycleState,
                head: <TestCaseStateChip state={row.lifecycleState as TestCaseLifecycleState} />,
                count: row._count,
                fill: "var(--accent)"
              }))}
            />
          </>
        )}
      </div>

      <h2>Executions by lifecycle state</h2>
      <MetricStatement metric={executionStates} />
      <div className="card card-flush" style={{ marginBottom: "var(--sp-6)" }}>
        {executionStates.counts.length === 0 ? (
          <div className="empty">
            <p>No executions planned yet.</p>
          </div>
        ) : (
          <>
            <p className="sr-only">
              Executions by lifecycle state:{" "}
              {executionStates.counts.map((row) => `${row.state} ${row._count}`).join(", ")}.
            </p>
            <BarRows
              rows={executionStates.counts.map((row) => ({
                key: row.state,
                head: <ExecutionStateChip state={row.state as ExecutionLifecycleState} />,
                count: row._count,
                fill: "var(--accent)"
              }))}
            />
          </>
        )}
      </div>

      <h2>Defects by status</h2>
      <MetricStatement metric={defectStates} />
      <div className="card card-flush" style={{ marginBottom: "var(--sp-6)" }}>
        {defectStates.counts.length === 0 ? (
          <div className="empty">
            <p>No defects recorded.</p>
          </div>
        ) : (
          <>
            <p className="sr-only">
              Defects by status:{" "}
              {defectStates.counts.map((row) => `${row.status} ${row._count}`).join(", ")}.
            </p>
            <BarRows
              rows={defectStates.counts.map((row) => ({
                key: row.status,
                head: <DefectStatusChip status={row.status as DefectLifecycleState} />,
                count: row._count,
                fill: "var(--accent)"
              }))}
            />
          </>
        )}
      </div>

      <h2>Requirements by trace linkage</h2>
      <MetricStatement metric={linkage} />
      <div className="card card-flush">
        {linkage.denominatorCount === 0 ? (
          <div className="empty">
            <p>No requirements recorded yet.</p>
            <Link className="btn btn-ghost" href="/traceability">
              Go to traceability
            </Link>
          </div>
        ) : (
          <>
            <p className="why" style={{ margin: "var(--sp-3) var(--sp-4)" }}>
              <strong>These are counts, not coverage.</strong> An unlinked requirement is a
              requirement with no recorded link — the system does not infer from that whether it is
              tested (<code>business-rules-and-validation.md:36</code>).
            </p>
            <p className="sr-only">
              Requirements by trace linkage:{" "}
              {linkage.counts.map((row) => `${row.linkage} ${row._count}`).join(", ")}.
            </p>
            <BarRows
              rows={linkage.counts.map((row) => ({
                key: row.linkage,
                head: <span style={{ fontWeight: 620, fontSize: 13.5 }}>{row.linkage}</span>,
                count: row._count,
                fill: "var(--accent)"
              }))}
            />
          </>
        )}
      </div>
    </>
  );
}
