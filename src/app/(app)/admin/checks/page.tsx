import Link from "next/link";
import {
  ChevronRight,
  Download,
  FileText,
  FileUp,
  Inbox,
  Info,
  Layers,
  Rows3,
  Split,
  Tag,
  Zap
} from "lucide-react";
import { QamsRole } from "@prisma/client";
import { notFound } from "next/navigation";
import { SAMPLE_TEST_CASE_ID } from "@/domain/check-sample";
import { listCheckBatches } from "@/domain/checks";
import { formatMinute, viewerStampFormat } from "@/ui/format";
import { readPage, readPageSize, type ListSearchParams } from "@/ui/list-params";
import { PAGE_SIZE, PAGE_SIZE_OPTIONS } from "@/ui/paging";
import { ListEmpty } from "@/ui/list-empty";
import { Pager } from "@/ui/pager";
import { requireSession } from "@/ui/session";
import { formatBytes, maxUploadBytes } from "@/lib/upload-limits";
import { OBSERVED_FILINGS, UNRESOLVED_COLUMN_LABEL, UNRESOLVED_FILINGS } from "./check-tone";
import { UploadForm } from "./UploadForm";

export const dynamic = "force-dynamic";

type BatchReport = { counts?: Record<string, number>; rows?: unknown[] };

/**
 * The id the empty state's call to action jumps to, so it lands on the form that fills it.
 * A fragment and not a button: it works before hydration, and there is nothing to focus that
 * a person would not have to scroll to anyway.
 */
const INGEST_ANCHOR = "ingest";

/**
 * One count cell in the batch table.
 *
 * A zero keeps its slot as a dash rather than a `0`: four columns of zeros is noise, and an
 * empty cell reads as a rendering fault — the same call `.week-bar[data-zero]` makes about a
 * quiet week. The dash is `aria-hidden` with the number beside it in `.sr-only`, because a
 * screen reader announcing "en dash" down a numeric column is worse than one saying "zero".
 */
function Count({ n }: { n: number }) {
  return (
    <td className="num">
      {n === 0 ? (
        <span className="num-none">
          <span aria-hidden>–</span>
          <span className="sr-only">0</span>
        </span>
      ) : (
        <strong>{n}</strong>
      )}
    </td>
  );
}

/**
 * The Automation checks screen.
 *
 * Laid out as a `.page-banner` because what this feature does NOT do is as load-bearing as
 * what it does — it records observations and moves nothing else — and that has to be read
 * before anybody uploads anything. The upload takes the wide column, the facts that qualify
 * it sit beside it in the aside, and the batch table spans the full width underneath.
 *
 * The screen takes the whole viewport (`.shell-main:has(.checks-screen)`), which the catalogue
 * is otherwise alone in doing. Both of its largest elements want the room — a nine-column table
 * and a drop target — and it is the measures that are capped rather than the page, so no line
 * of prose here grows with the monitor.
 */
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
    <div className="checks-screen">
      <div className="page-banner">
        <span className="medallion medallion-lg medallion-sq" aria-hidden>
          <Zap size={22} strokeWidth={1.9} aria-hidden />
        </span>
        <div className="page-banner-text">
          <h1>Automation checks</h1>
          <p className="page-banner-lede">
            What an automation suite observed about these test cases. QAMS records the results; it
            never runs a suite, and it holds no link between a test case and the spec that checks it
            — a spec reaches a case only by naming its business ID.
          </p>
        </div>
        {/* Screen-level, and deliberately not part of the upload card: a contract is the
            convention an automation team works to, agreed once, and its own screen carries the
            copy that explains it. It used to sit inside "Ingest a results file", which is the one
            thing it is not — the file it produces names real test cases and cannot be ingested. */}
        <div className="page-banner-actions">
          <Link className="btn btn-secondary btn-icon" href="/admin/checks/naming-contract">
            <FileText size={15} aria-hidden /> Naming contract
          </Link>
        </div>
      </div>

      {/* `.checks-top` and not `.detail-cols`: that grid's aside is a fixed 340px, which is a
          metadata rail's width and reads as a sliver once this screen has no width cap. */}
      <div className="checks-top">
        <section className="card" id={INGEST_ANCHOR}>
          <div className="panel-head">
            <span className="medallion" aria-hidden>
              <FileUp size={19} strokeWidth={1.9} aria-hidden />
            </span>
            <div className="panel-head-text">
              <h2>Ingest a results file</h2>
              <p>One run, recorded as observations against the cases its tests name.</p>
            </div>
          </div>

          {/* The cap is resolved on the server and handed over as a word. It is a deployment
              default and not a documented rule (`src/lib/upload-limits.ts`), which is why the
              form states it as this deployment's limit. */}
          <UploadForm maxLabel={formatBytes(maxUploadBytes())} />

          <ul className="action-list">
            <li>
              {/* A plain <a>, not <Link>: this is a file download, not a navigation, and
                  the client router would try to render the response as a page. */}
              <a className="action-row" href="/admin/checks/sample" download>
                <span className="medallion medallion-sq" aria-hidden>
                  <Download size={19} strokeWidth={1.9} aria-hidden />
                </span>
                <span className="action-row-text">
                  <span className="action-row-title">Sample results file</span>
                  <span className="action-row-said">
                    Every outcome ingestion records, in the shape it reads. Your runner writes this
                    file; it is not filled in by hand. Uploading it unchanged writes no checks — its
                    tests name <span className="bid">{SAMPLE_TEST_CASE_ID}</span>, so every row
                    reports Reference not found, unless a product tagged SAMPLE exists here.
                  </span>
                </span>
                <ChevronRight size={16} aria-hidden className="action-row-go" />
              </a>
            </li>
          </ul>
        </section>

        {/*
         * The aside states the four things that decide what an upload will do, because each one
         * is a way a reader can be surprised by a file they already sent. Every line paraphrases
         * something the system actually does — how a test reaches a case, that unresolved rows
         * are still reported, that Errored is held apart from Failed, and that batches
         * accumulate. No thresholds, targets or advice: `business-rules-and-validation.md`
         * defines none for automation checks, and a tip with no basis is advice.
         *
         * Each fact carries a mark that means it — a name tag, a full set of rows, a split, a
         * stack — so a reader coming back for one of the four finds it by shape. All four are the
         * same untinted medallion: see `.fact-list` for why a tick or a hue per fact is the one
         * thing this particular aside may not do.
         */}
        <aside className="card">
          <div className="panel-head">
            <span className="medallion" aria-hidden>
              <Info size={19} strokeWidth={1.9} aria-hidden />
            </span>
            <div className="panel-head-text">
              <h2>How a file is read</h2>
              <p>What ingestion does with an upload, and what it leaves alone.</p>
            </div>
          </div>
          <ul className="fact-list">
            <li>
              <span className="medallion medallion-sq" aria-hidden>
                <Tag size={18} strokeWidth={1.9} aria-hidden />
              </span>
              <span>
                <strong>A test finds its case by name.</strong> The business ID has to appear in the
                test name or its class name. Nothing else joins the two, in either direction.
              </span>
            </li>
            <li>
              <span className="medallion medallion-sq" aria-hidden>
                <Rows3 size={18} strokeWidth={1.9} aria-hidden />
              </span>
              <span>
                <strong>Nothing in the file is dropped.</strong> A test naming no case, or one that
                is not here, still appears in the batch report — which is how a gap becomes visible
                instead of looking like a shorter run.
              </span>
            </li>
            <li>
              <span className="medallion medallion-sq" aria-hidden>
                <Split size={18} strokeWidth={1.9} aria-hidden />
              </span>
              <span>
                <strong>Errored is not failed.</strong> A spec that fell over is reported apart from
                one that observed a failure: a broken spec is not broken software.
              </span>
            </li>
            <li>
              <span className="medallion medallion-sq" aria-hidden>
                <Layers size={18} strokeWidth={1.9} aria-hidden />
              </span>
              <span>
                <strong>Every upload is its own batch.</strong> Ingesting the same suite again
                records a new observation beside the last one. Nothing is overwritten, and no
                earlier check is revised.
              </span>
            </li>
          </ul>
        </aside>
      </div>

      <section>
        <div className="page-head">
          <h2>Batches</h2>
          {total > 0 ? (
            <span className="muted">
              {total} {total === 1 ? "file" : "files"} ingested
            </span>
          ) : null}
        </div>
        <div className="card card-flush">
          {batches.length === 0 ? (
            /*
             * Through `ListEmpty`, because this list renders no rows for two unrelated reasons and
             * the screen used to report only one of them: `readPage` does not clamp, so `?page=2`
             * on a deployment with a single page of batches printed "No results ingested yet"
             * directly above a pager saying "Showing 1–50 of 60". The furnished state below is now
             * only reached when there genuinely is nothing — which is the one case where offering
             * a way to fill it is honest.
             */
            <ListEmpty
              total={total}
              pathname="/admin/checks"
              params={params}
              noMatch={
                <>
                  <span className="medallion medallion-lg medallion-sq empty-mark" aria-hidden>
                    <Inbox size={22} strokeWidth={1.9} aria-hidden />
                  </span>
                  <p className="empty-title">No results ingested yet</p>
                  <p>
                    Every upload appears here with what it recorded, including the tests that
                    reached no test case at all.
                  </p>
                  <a className="btn btn-icon" href={`#${INGEST_ANCHOR}`}>
                    <FileUp size={15} aria-hidden /> Ingest a results file
                  </a>
                </>
              }
            />
          ) : (
            <>
              {/*
               * One column per outcome, not one cell holding a chip per outcome.
               *
               * The Recorded cell it replaced built its chips from `Object.entries(counts)` —
               * file order — so the same outcome sat in a different position on every row and a
               * clean run showed two chips where a bad one showed five. The column could not be
               * scanned, which is the failure that moved this list off `.list-row` in the first
               * place; a chip bag inside one cell is still prose.
               *
               * The words are `<th>`s now (already mono, uppercase, 10.5px — a column label) and
               * the cells are figures under them. See `.data-table td.num` for why they are not
               * toned.
               *
               * COLUMN ORDER IS LOAD-BEARING: the tallies sit left of who and when. The browser
               * suite runs at 1440x900 because a column pushed outside `.table-scroll` is
               * clipped and Cypress correctly calls it "not visible"
               * (`docs/testing-and-acceptance.md` § "Browser suite"), so the answer a Lead came
               * for stays inside the fold however long a file name someone's runner chooses.
               */}
              <div className="table-scroll">
                <table className="data-table">
                  {/* Without a name this announces as an unnamed table in a screen reader's
                      table list. */}
                  <caption className="sr-only">Ingested automation results files</caption>
                  <thead>
                    <tr>
                      <th scope="col">File</th>
                      <th scope="col" className="num">
                        Tests
                      </th>
                      {OBSERVED_FILINGS.map((filing) => (
                        <th key={filing.key} scope="col" className="num">
                          {filing.label}
                        </th>
                      ))}
                      <th scope="col" className="num">
                        {UNRESOLVED_COLUMN_LABEL}
                      </th>
                      <th scope="col">Ingested by</th>
                      <th scope="col">Started</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batches.map((batch) => {
                      const report = (batch.reportJson ?? {}) as BatchReport;
                      const counts = report.counts ?? {};
                      const total = report.rows?.length ?? 0;
                      /* Summed rather than given two columns: at list level the signal is "this
                         run had rows that reached no case, open it", and the batch report is
                         where the difference between the two decides what to fix. */
                      const unresolved = UNRESOLVED_FILINGS.reduce(
                        (sum, filing) => sum + (counts[filing.key] ?? 0),
                        0
                      );
                      return (
                        <tr key={batch.id}>
                          <td>
                            <Link
                              href={`/admin/checks/${batch.id}`}
                              className="row-link checks-file"
                            >
                              {batch.sourceFileName}
                            </Link>
                          </td>
                          {/* A parsed file with no tests in it renders as a zero like any
                              other; the batch report says "The file contained no tests." */}
                          <Count n={total} />
                          {OBSERVED_FILINGS.map((filing) => (
                            <Count key={filing.key} n={counts[filing.key] ?? 0} />
                          ))}
                          <Count n={unresolved} />
                          {/* Who carried the file in, and nobody who verified anything — the
                              only person a batch records (see `CheckBatch` in the schema). */}
                          <td>{batch.actor.displayName}</td>
                          <td>
                            <time dateTime={batch.startedAt.toISOString()}>
                              {formatMinute(batch.startedAt, stampFormat)}
                            </time>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
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
      </section>
    </div>
  );
}
