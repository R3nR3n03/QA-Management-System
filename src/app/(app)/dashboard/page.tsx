import Link from "next/link";
import { LayoutDashboard } from "lucide-react";
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
 * The dashboard: KPIs, the one trend, then the documented metric groups as labeled horizontal
 * bars. `business-rules-and-validation.md:56` requires execution and defect metrics to state
 * their filters, numerator, denominator, and as-of time BEFORE being shown, so the statement
 * renders above every chart and is never folded away behind a disclosure — and nothing here is
 * graded, because that document defines no threshold to grade against.
 *
 * Chart discipline (dataviz): identity is carried by each row's text label and chip, never by
 * fill color alone; the result bars use the app's reserved status palette; the severity bars use
 * one neutral hue because severity values are QA-Lead-configurable strings, not a fixed series.
 *
 * ## The shape of the screen
 *
 * This was seven `<h2>` + statement + card blocks stacked down a 1040px column, six of them the
 * same small bar chart. One chart filled a laptop viewport, so comparing any two meant scrolling
 * between them — on the one screen whose entire job is comparison. They are peers, so they are
 * laid out as peers: `.dash-grid` tiles them, and the screen takes the width because more room
 * then means more charts on screen rather than wider charts.
 *
 * The trend leads the grid at full width. It is the only chart here answering
 * change-over-time rather than magnitude-across-categories, and a headline-numbers → trend →
 * breakdowns order is what a reader actually descends through.
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

/** A bar's label where the value has no chip of its own — a configurable string, or a word the
    domain returns. Sized and weighted by `.bar-label`, which is what the two call sites used to
    do with an inline `style` each. */
function BarLabel({ children }: { children: React.ReactNode }) {
  return <span className="bar-label">{children}</span>;
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

/**
 * The four things a metric must declare before it may be shown
 * (`business-rules-and-validation.md:56`).
 *
 * Four LABELLED facts rather than one prose sentence. It read `Filters: … . Numerator: … .
 * Denominator: … . As of … .` — a run-on that had to be parsed word by word to find the one part
 * a reader wanted, repeated above all seven charts, and set at body size so it competed with the
 * chart it qualifies. It is a caption now, and it wraps, so a reader can pick out `Denominator`
 * by looking rather than by reading.
 *
 * Still above the chart and still never collapsed: the rule says stated BEFORE being shown, which
 * a `<details>` would not satisfy.
 */
function MetricStatement({
  metric
}: {
  metric: { filters: string; numerator: string; denominator: string; asOfUtc: string };
}) {
  return (
    <p className="metric-note">
      <span>
        <b>Filters</b> {metric.filters}
      </span>
      <span>
        <b>Numerator</b> {metric.numerator}
      </span>
      <span>
        <b>Denominator</b> {metric.denominator}
      </span>
      {/* The raw UTC instant, deliberately not put through the viewer's stamp format: this is the
          audit value the rule asks for, and rendering it in a local zone would contradict the
          "(UTC)" the screen states. */}
      <span>
        <b>As of</b> {metric.asOfUtc}
      </span>
    </p>
  );
}

/**
 * One metric: its name, its declaration, and its chart.
 *
 * A component because this was the same twenty lines written six times, which is how the two
 * hand-styled bar labels and five inline card margins got in. No medallion, deliberately — the
 * design system reserves one for a panel whose contents are a task, and six marks beside six
 * headings on one screen would carry nothing the headings do not.
 */
function MetricPanel({
  title,
  metric,
  wide = false,
  children
}: {
  title: string;
  metric: { filters: string; numerator: string; denominator: string; asOfUtc: string };
  /** Spans the grid. For the trend, which is a row of columns and needs the width. */
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={wide ? "card dash-panel dash-panel-wide" : "card dash-panel"}>
      <div className="dash-panel-head">
        <h2>{title}</h2>
        <MetricStatement metric={metric} />
      </div>
      {children}
    </section>
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
    <div className="dash-screen">
      {/* A `.page-banner`: what this screen does NOT do is load-bearing — nothing on it is graded,
          because the knowledge base defines no threshold — and that has to be read before anybody
          draws a conclusion from a figure. That is the one case the banner is for. */}
      <div className="page-banner">
        <span className="medallion medallion-lg medallion-sq" aria-hidden>
          <LayoutDashboard size={22} strokeWidth={1.9} aria-hidden />
        </span>
        <div className="page-banner-text">
          <h1>Dashboard</h1>
          <p className="page-banner-lede">
            As of {snapshot.asOfUtc} (UTC). Counts come from persisted records, not imported
            spreadsheet formulas, and nothing here is graded — the knowledge base defines no
            thresholds.
          </p>
        </div>
      </div>

      {/* Read-only headline figures, and deliberately not `.stat-tile`s: a stat tile is a way IN
          to the rows it counts, and only one of these four has a list that shows exactly its
          figure (`/executions?state=FINALIZED`). Linking two of four and not the others would be
          an affordance that works sometimes, which is worse than one that never claims to. */}
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

      {/* The panels in one grid, related subjects adjacent — the two execution breakdowns, then
          the two defect ones, then cases and requirements — so a two-column layout puts each pair
          side by side rather than a page apart. */}
      <div className="dash-grid">
        <MetricPanel title="Finalized executions per week" metric={trend} wide>
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
        </MetricPanel>

        <MetricPanel title="Finalized executions by result" metric={executions}>
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
        </MetricPanel>

        <MetricPanel title="Executions by lifecycle state" metric={executionStates}>
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
        </MetricPanel>

        <MetricPanel title="Open defects by severity" metric={defects}>
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
                  head: <BarLabel>{row.severity || "Not set"}</BarLabel>,
                  count: row._count,
                  fill: "var(--accent)"
                }))}
              />
            </>
          )}
        </MetricPanel>

        <MetricPanel title="Defects by status" metric={defectStates}>
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
        </MetricPanel>

        <MetricPanel title="Test cases by lifecycle state" metric={caseStates}>
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
        </MetricPanel>

        <MetricPanel title="Requirements by trace linkage" metric={linkage}>
          {linkage.denominatorCount === 0 ? (
            <div className="empty">
              <p>No requirements recorded yet.</p>
              <Link className="btn btn-ghost" href="/traceability">
                Go to traceability
              </Link>
            </div>
          ) : (
            <>
              {/* The one panel here that has to correct a reading a reader would otherwise make.
                  Spaced by `.dash-panel > .why`, not an inline margin. */}
              <p className="why">
                <strong>These are counts, not coverage.</strong> An unlinked requirement is a
                requirement with no recorded link — the system does not infer from that whether it
                is tested (<code>business-rules-and-validation.md:36</code>).
              </p>
              <p className="sr-only">
                Requirements by trace linkage:{" "}
                {linkage.counts.map((row) => `${row.linkage} ${row._count}`).join(", ")}.
              </p>
              <BarRows
                rows={linkage.counts.map((row) => ({
                  key: row.linkage,
                  head: <BarLabel>{row.linkage}</BarLabel>,
                  count: row._count,
                  fill: "var(--accent)"
                }))}
              />
            </>
          )}
        </MetricPanel>
      </div>
    </div>
  );
}
