import Link from "next/link";
import { QamsRole } from "@prisma/client";
import { notFound } from "next/navigation";
import { listImportRuns } from "@/domain/imports";
import { readPage, type ListSearchParams } from "@/ui/list-params";
import { Pager } from "@/ui/pager";
import { requireSession } from "@/ui/session";
import { UploadForm } from "./UploadForm";

export const dynamic = "force-dynamic";

export default async function ImportsPage({
  searchParams
}: {
  searchParams: Promise<ListSearchParams>;
}) {
  const params = await searchParams;
  const auth = await requireSession();
  // Lead-only screen: absent rather than present-and-rejecting for other roles
  // (the domain services behind it refuse them regardless).
  if (auth.role !== QamsRole.QA_LEAD) notFound();
  const page = readPage(params);
  const { rows: runs, total } = await listImportRuns(auth.role, { page });

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
      <div className="card card-flush">
        {runs.length === 0 ? (
          <div className="empty">
            <p>No imports yet.</p>
          </div>
        ) : (
          runs.map((run) => (
            <div key={run.id} className="list-row">
              <div className="row-main">
                <div className="row-title">{run.sourceFileName}</div>
                <div className="muted">
                  {run.startedAt.toISOString()} · {run.status}
                  {run.completedAt ? ` · completed ${run.completedAt.toISOString()}` : ""}
                </div>
              </div>
              <span
                className={
                  run.status === "COMPLETED" || run.status === "FAILED"
                    ? "state state-accent"
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
        <Pager total={total} page={page} pathname="/admin/imports" params={params} label="import runs" />
      </div>
    </>
  );
}
