import Link from "next/link";
import { ChevronRight, Download } from "lucide-react";
import { QamsRole } from "@prisma/client";
import { notFound } from "next/navigation";
import { listImportRuns } from "@/domain/imports";
import { formatMinute, viewerStampFormat } from "@/ui/format";
import { readPage, readPageSize, type ListSearchParams } from "@/ui/list-params";
import { RUN_STATUS_TONE, toneFor } from "./[id]/outcome-tone";
import { PAGE_SIZE, PAGE_SIZE_OPTIONS } from "@/ui/paging";
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
  const pageSize = readPageSize(params, PAGE_SIZE_OPTIONS, PAGE_SIZE);
  const { rows: runs, total } = await listImportRuns(auth.role, { page, pageSize });
  const stampFormat = viewerStampFormat(auth);

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
        <div className="row" style={{ marginTop: "var(--sp-4)" }}>
          {/* A plain <a>, not <Link>: this is a file download, not a navigation, and
              the client router would try to render the response as a page. */}
          <a className="btn btn-secondary btn-sm" href="/admin/imports/sample" download>
            <Download size={14} aria-hidden /> Sample workbook
          </a>
          <span className="hint row-main">
            Every sheet and column the importer expects, with a worked example that chains
            PROD001 &rarr; MOD001 &rarr; FEAT001 &rarr; REQ001 &rarr; TC-PROD001-0001. Test
            Execution and Execution History carry headers only — their Tester column has to
            name a user that already exists here, which a generic template cannot know.
          </span>
        </div>
      </div>

      <h2>Runs</h2>
      <div className="card card-flush">
        {runs.length === 0 ? (
          // The pager stays inside the non-empty branch: with `sizeOptions` passed it
          // can never take its own bail-out, so an empty list was followed by
          // "Showing 0 of 0 · Rows 25 50 100".
          <div className="empty">
            <p>No imports yet. Upload a workbook above to seed the catalogue.</p>
          </div>
        ) : (
          <>
            <ul className="row-list">
              {runs.map((run) => (
                <li key={run.id} className="list-row">
                  <div className="row-main">
                    <div className="row-title">
                      <Link className="row-link" href={`/admin/imports/${run.id}`}>
                        {run.sourceFileName}
                      </Link>
                    </div>
                    {/* The house format, via the shared formatter — these screens were
                        the only ones printing a raw `2026-08-04T09:12:33.123Z`. */}
                    <div className="muted">
                      <time dateTime={run.startedAt.toISOString()}>
                        {formatMinute(run.startedAt, stampFormat)}
                      </time>
                      {run.completedAt ? (
                        <>
                          {" · completed "}
                          <time dateTime={run.completedAt.toISOString()}>
                            {formatMinute(run.completedAt, stampFormat)}
                          </time>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <span className={toneFor(RUN_STATUS_TONE, run.status)}>{run.status}</span>
                  <Link
                    className="btn btn-secondary btn-sm"
                    href={`/admin/imports/${run.id}`}
                    aria-label={`Report for ${run.sourceFileName}`}
                    tabIndex={-1}
                  >
                    Report
                    <ChevronRight size={14} aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
            <Pager
              total={total}
              page={page}
              pathname="/admin/imports"
              params={params}
              pageSize={pageSize}
              sizeOptions={PAGE_SIZE_OPTIONS}
              label="import runs"
            />
          </>
        )}
      </div>
    </>
  );
}
