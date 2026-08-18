import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { QamsRole } from "@prisma/client";
import { notFound } from "next/navigation";
import { listCheckBatches } from "@/domain/checks";
import { formatMinute, viewerStampFormat } from "@/ui/format";
import { readPage, readPageSize, type ListSearchParams } from "@/ui/list-params";
import { PAGE_SIZE, PAGE_SIZE_OPTIONS } from "@/ui/paging";
import { Pager } from "@/ui/pager";
import { requireSession } from "@/ui/session";
import { countLabel } from "./check-tone";
import { UploadForm } from "./UploadForm";

export const dynamic = "force-dynamic";

type BatchReport = { counts?: Record<string, number> };

export default async function CheckBatchesPage({
  searchParams
}: {
  searchParams: Promise<ListSearchParams>;
}) {
  const params = await searchParams;
  const auth = await requireSession();
  // Lead-only screen: absent rather than present-and-rejecting for other roles
  // (the domain service behind it refuses them regardless).
  if (auth.role !== QamsRole.QA_LEAD) notFound();
  const page = readPage(params);
  const pageSize = readPageSize(params, PAGE_SIZE_OPTIONS, PAGE_SIZE);
  const { rows: batches, total } = await listCheckBatches(auth.role, { page, pageSize });
  const stampFormat = viewerStampFormat(auth);

  return (
    <>
      <h1>Automation checks</h1>
      <p className="muted" style={{ marginBottom: "var(--sp-4)" }}>
        What an automation suite observed about these test cases. QAMS records the results; it
        never runs a suite, and it holds no link between a test case and the spec that checks it —
        a spec reaches a case only by naming its business ID.
      </p>

      <h2>Ingest a results file</h2>
      <div className="card" style={{ marginBottom: "var(--sp-6)" }}>
        <UploadForm />
      </div>

      <h2>Batches</h2>
      <div className="card card-flush">
        {batches.length === 0 ? (
          <div className="empty">
            <p>No results ingested yet. Upload a JUnit XML file above.</p>
          </div>
        ) : (
          <>
            <ul className="row-list">
              {batches.map((batch) => {
                const counts = ((batch.reportJson ?? {}) as BatchReport).counts ?? {};
                const summary = Object.entries(counts)
                  .map(([key, n]) => `${n} ${countLabel(key)}`)
                  .join(" · ");
                return (
                  <li key={batch.id} className="list-row">
                    <Link href={`/admin/checks/${batch.id}`} className="row-main">
                      <span className="bid">{batch.sourceFileName}</span>
                      <span className="muted">
                        {" "}
                        <time dateTime={batch.startedAt.toISOString()}>
                          {formatMinute(batch.startedAt, stampFormat)}
                        </time>
                        {summary ? ` · ${summary}` : null}
                      </span>
                    </Link>
                    <ChevronRight size={16} aria-hidden className="muted" />
                  </li>
                );
              })}
            </ul>
            <Pager
              total={total}
              page={page}
              pathname="/admin/checks"
              params={params}
              pageSize={pageSize}
              sizeOptions={PAGE_SIZE_OPTIONS}
              label="check batches"
            />
          </>
        )}
      </div>
    </>
  );
}
