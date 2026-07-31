import { QamsRole } from "@prisma/client";
import { notFound } from "next/navigation";
import { getImportRun } from "@/domain/imports";
import { AppError } from "@/lib/errors";
import { requireSession } from "@/ui/session";

export const dynamic = "force-dynamic";

type RunReport = {
  outcomeCounts?: Record<string, Record<string, number>>;
  unknownColumns?: Record<string, string[]>;
  dashboard?: { products: number; testCases: number };
  policyGaps?: string[];
};

const OUTCOME_TONE: Record<string, string> = {
  CREATED: "state state-pass",
  SKIPPED_UNCHANGED: "state",
  RECONCILIATION_REQUIRED: "state state-blocked",
  REJECTED: "state state-fail"
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
        <div style={{ marginBottom: "var(--sp-5)" }}>
          {report.policyGaps.map((gap) => (
            <p key={gap} className="why" style={{ marginBottom: "var(--sp-2)" }}>
              {gap}
            </p>
          ))}
        </div>
      ) : null}

      {Object.keys(outcomeCounts).length > 0 ? (
        <>
          <h2>Outcomes by sheet</h2>
          <div className="card" style={{ padding: 0, marginBottom: "var(--sp-5)" }}>
            {Object.entries(outcomeCounts).map(([sheet, counts]) => (
              <div
                key={sheet}
                style={{ display: "flex", gap: "var(--sp-3)", padding: "var(--sp-3) var(--sp-5)", borderBottom: "1px solid var(--line-soft)", flexWrap: "wrap", alignItems: "center" }}
              >
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
      <div className="card" style={{ padding: 0 }}>
        {run.rows.length === 0 ? (
          <p className="muted" style={{ padding: "var(--sp-4) var(--sp-5)", margin: 0 }}>
            No row reports for this run.
          </p>
        ) : (
          run.rows.map((row) => (
            <div
              key={row.id}
              style={{ display: "flex", gap: "var(--sp-3)", padding: "var(--sp-2) var(--sp-5)", borderBottom: "1px solid var(--line-soft)", flexWrap: "wrap", alignItems: "baseline" }}
            >
              <span className="muted" style={{ minWidth: 150 }}>
                {row.sourceSheet} · row {row.sourceRow}
              </span>
              <span className={OUTCOME_TONE[row.outcome] ?? "state"}>{row.outcome}</span>
              {row.errorCode ? <span className="bid">{row.errorCode}</span> : null}
              <span style={{ flex: 1, minWidth: 220, color: "var(--ink-2)", fontSize: 13.5 }}>
                {row.details ?? ""}
              </span>
            </div>
          ))
        )}
      </div>
    </>
  );
}
