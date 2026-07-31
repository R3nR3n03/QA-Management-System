import Link from "next/link";
import { QamsRole } from "@prisma/client";
import { notFound } from "next/navigation";
import { listImportRuns } from "@/domain/imports";
import { requireSession } from "@/ui/session";
import { UploadForm } from "./UploadForm";

export const dynamic = "force-dynamic";

export default async function ImportsPage() {
  const auth = await requireSession();
  // Lead-only screen: absent rather than present-and-rejecting for other roles
  // (the domain services behind it refuse them regardless).
  if (auth.role !== QamsRole.QA_LEAD) notFound();
  const runs = await listImportRuns(auth.role);

  return (
    <>
      <h1>Workbook imports</h1>
      <p className="muted" style={{ marginBottom: "var(--sp-4)" }}>
        The workbook is a one-time seed source, never a live authority. Re-importing the same file is
        safe: unchanged rows are skipped, changed rows are held for reconciliation.
      </p>

      <h2>Import a workbook</h2>
      <div className="card" style={{ marginBottom: "var(--sp-6)" }}>
        <UploadForm />
      </div>

      <h2>Runs</h2>
      <div className="card" style={{ padding: 0 }}>
        {runs.length === 0 ? (
          <p className="muted" style={{ padding: "var(--sp-4) var(--sp-5)", margin: 0 }}>
            No imports yet.
          </p>
        ) : (
          runs.map((run) => (
            <div
              key={run.id}
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
                <div style={{ fontWeight: 600, color: "var(--ink)" }}>{run.sourceFileName}</div>
                <div className="muted">
                  {run.startedAt.toISOString()} · {run.status}
                  {run.completedAt ? ` · completed ${run.completedAt.toISOString()}` : ""}
                </div>
              </div>
              <span
                className={
                  run.status === "COMPLETED"
                    ? "state state-pass"
                    : run.status === "FAILED"
                      ? "state state-fail"
                      : "state"
                }
              >
                {run.status}
              </span>
              <Link href={`/admin/imports/${run.id}`} style={{ fontSize: 14 }}>
                Report
              </Link>
            </div>
          ))
        )}
      </div>
    </>
  );
}
