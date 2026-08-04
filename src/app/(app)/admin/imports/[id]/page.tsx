import { QamsRole } from "@prisma/client";
import { notFound } from "next/navigation";
import { getImportRun } from "@/domain/imports";
import { AppError } from "@/lib/errors";
import { requireSession } from "@/ui/session";
import { Breadcrumbs } from "@/ui/breadcrumbs";
import { OUTCOME_TONE } from "./outcome-tone";
import { RowsTable } from "./RowsTable";

export const dynamic = "force-dynamic";

type RunReport = {
  outcomeCounts?: Record<string, Record<string, number>>;
  unknownColumns?: Record<string, string[]>;
  dashboard?: { products: number; testCases: number };
  policyGaps?: string[];
  policyNotes?: string[];
};

/**
 * The row-level import report the rules require: source sheet and row, outcome,
 * error code, record ID (`business-rules-and-validation.md:46`). Reconciliation-
 * required rows stay uncommitted until the QA Lead resolves them through the
 * documented follow-up operation — which is still an open policy escalation.
 */
export default async function ImportRunPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  // Lead-only screen: absent rather than present-and-rejecting for other roles
  // (the domain services behind it refuse them regardless).
  if (auth.role !== QamsRole.QA_LEAD) notFound();
  const { id } = await params;

  let run;
  try {
    run = await getImportRun(id);
  } catch (error) {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  }

  const report = (run.reportJson ?? {}) as RunReport;
  const outcomeCounts = report.outcomeCounts ?? {};

  return (
    <>
      <Breadcrumbs trail={[{ href: "/admin/imports", label: "Workbook imports" }]} here={run.sourceFileName} />
      <h1>{run.sourceFileName}</h1>
      <p className="muted">
        {run.status} · started {run.startedAt.toISOString()}
        {run.completedAt ? ` · completed ${run.completedAt.toISOString()}` : ""}
        {run.sourceFileHash ? (
          <>
            {" · sha256 "}
            <span className="bid">{run.sourceFileHash.slice(0, 12)}…</span>
          </>
        ) : null}
      </p>

      {report.policyGaps && report.policyGaps.length > 0 ? (
        <div className="stack" style={{ marginBottom: "var(--sp-5)" }}>
          {report.policyGaps.map((gap) => (
            <p key={gap} className="why">
              {gap}
            </p>
          ))}
        </div>
      ) : null}

      {report.policyNotes && report.policyNotes.length > 0 ? (
        <div className="card card-flush" style={{ marginBottom: "var(--sp-5)" }}>
          <div className="stack">
            {report.policyNotes.map((note) => (
              <p key={note} className="muted">
                {note}
              </p>
            ))}
          </div>
        </div>
      ) : null}

      {Object.keys(outcomeCounts).length > 0 ? (
        <>
          <h2>Outcomes by sheet</h2>
          <div className="card card-flush" style={{ marginBottom: "var(--sp-5)" }}>
            {Object.entries(outcomeCounts).map(([sheet, counts]) => (
              <div key={sheet} className="list-row">
                <span style={{ fontWeight: 620, minWidth: 160 }}>{sheet}</span>
                {Object.entries(counts).map(([outcome, count]) => (
                  <span key={outcome} className={OUTCOME_TONE[outcome] ?? "state"}>
                    {outcome} {count}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </>
      ) : null}

      <h2>Rows</h2>
      <div className="card card-flush">
        {run.rows.length === 0 ? (
          <div className="empty">
            <p>No row reports for this run.</p>
          </div>
        ) : (
          <RowsTable
            rows={run.rows.map((row) => ({
              id: row.id,
              sourceSheet: row.sourceSheet,
              sourceRow: row.sourceRow,
              outcome: row.outcome,
              errorCode: row.errorCode,
              details: row.details,
              proposedValues: (row.proposedValuesJson as Record<string, string> | null) ?? null,
              resolutionDecision: row.resolutionDecision,
              resolutionRationale: row.resolutionRationale,
              resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
              resolvedBy: row.resolvedBy
            }))}
            runId={run.id}
          />
        )}
      </div>
    </>
  );
}
