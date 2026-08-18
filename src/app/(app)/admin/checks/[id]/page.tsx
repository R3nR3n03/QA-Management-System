import { QamsRole } from "@prisma/client";
import { notFound } from "next/navigation";
import { getCheckBatch } from "@/domain/checks";
import { AppError } from "@/lib/errors";
import { formatMinute, viewerStampFormat } from "@/ui/format";
import { requireSession } from "@/ui/session";
import { Breadcrumbs } from "@/ui/breadcrumbs";
import { CheckOutcomeChip } from "@/ui/chips";
import { ROW_OUTCOME_LABEL, ROW_OUTCOME_TONE, checkToneFor } from "../check-tone";

export const dynamic = "force-dynamic";

/**
 * The per-row report for one ingested results file.
 *
 * Every `<testcase>` in the file appears here, including the ones that produced no check.
 * That is the whole reason this screen exists: a test naming a case that does not exist, or
 * naming none at all, is otherwise invisible — no check is written, and the run looks like it
 * simply covered less than it did.
 */
export default async function CheckBatchPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (auth.role !== QamsRole.QA_LEAD) notFound();
  const { id } = await params;

  let batch;
  try {
    batch = await getCheckBatch(id, auth.role);
  } catch (error) {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  }

  const stampFormat = viewerStampFormat(auth);
  const unresolved = batch.rows.filter((row) => row.outcome !== "CREATED");

  return (
    <>
      <Breadcrumbs trail={[{ href: "/admin/checks", label: "Automation checks" }]} here={batch.sourceFileName} />
      <h1>{batch.sourceFileName}</h1>
      <p className="muted">
        Ingested by this deployment · started{" "}
        <time dateTime={batch.startedAt.toISOString()}>{formatMinute(batch.startedAt, stampFormat)}</time>
        {batch.completedAt ? (
          <>
            {" · completed "}
            <time dateTime={batch.completedAt.toISOString()}>
              {formatMinute(batch.completedAt, stampFormat)}
            </time>
          </>
        ) : null}
      </p>

      {unresolved.length > 0 ? (
        <p className="why" style={{ marginBottom: "var(--sp-5)" }}>
          <strong>
            {unresolved.length} of {batch.rows.length} tests recorded no check.
          </strong>{" "}
          A test reaches a test case only by naming its business ID. These ones named a case that
          does not exist here, or named none — so nothing was recorded against any case for them.
        </p>
      ) : null}

      <h2>Rows</h2>
      <div className="card card-flush">
        {batch.rows.length === 0 ? (
          <div className="empty">
            <p>The file contained no tests.</p>
          </div>
        ) : (
          <ul className="row-list">
            {batch.rows.map((row, index) => (
              <li key={`${row.specName}-${row.testName}-${index}`} className="list-row">
                <span className="row-main">
                  <span className="bid">{row.businessId ?? "—"}</span>{" "}
                  <span>{row.testName}</span>
                  <span className="muted"> · {row.specName}</span>
                </span>
                {row.checkOutcome ? <CheckOutcomeChip outcome={row.checkOutcome} /> : null}
                <span className={checkToneFor(ROW_OUTCOME_TONE, row.outcome)}>
                  {ROW_OUTCOME_LABEL[row.outcome] ?? row.outcome}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
