import { QamsRole } from "@prisma/client";
import { notFound } from "next/navigation";
import { getCheckBatch, listChecksForBatch } from "@/domain/checks";
import { AppError } from "@/lib/errors";
import { formatMinute, viewerStampFormat } from "@/ui/format";
import { requireSession } from "@/ui/session";
import { Breadcrumbs } from "@/ui/breadcrumbs";
import { BatchReport, type CheckRowData } from "./BatchReport";

export const dynamic = "force-dynamic";

/**
 * The per-row report for one ingested results file.
 *
 * Everything below the breadcrumb is `BatchReport` — the head that says what the file
 * recorded, and the rows themselves with their sorting, filtering and paging. It is one
 * component because the tallies in the head ARE the row filter, and one piece of state cannot
 * be split across a grid this page owns (the inversion `DESIGN-SYSTEM.md` records for
 * `FinalizeForm`). Stamps are formatted here, where the viewer's preferences are known, and
 * handed over as words.
 *
 * What stays here is the join. The stored report names the check each row produced but not
 * the test case it landed on, and not the runner's failure reason; both are on the `Check`
 * row, reachable by the `checkId` every CREATED row has always carried. Doing it this way
 * rather than widening `reportJson` means batches ingested before today get the link and the
 * reason too, and no migration is needed.
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

  const checks = await listChecksForBatch(batch.id, auth.role);
  const byCheckId = new Map(checks.map((check) => [check.id, check]));

  const stampFormat = viewerStampFormat(auth);
  const rows: CheckRowData[] = batch.rows.map((row, index) => {
    const check = row.checkId === null ? undefined : byCheckId.get(row.checkId);
    return {
      // The file's own order, which is the run's order, and the table's default sort.
      position: index + 1,
      businessId: row.businessId,
      testName: row.testName,
      specName: row.specName,
      outcome: row.outcome,
      checkOutcome: row.checkOutcome,
      testCaseId: check?.testCaseId ?? null,
      failureReason: check?.failureReason ?? null
    };
  });

  return (
    <>
      <Breadcrumbs
        trail={[{ href: "/admin/checks", label: "Automation checks" }]}
        here={batch.sourceFileName}
      />
      {/* No uploader's name here, deliberately. `getCheckBatch` is what
          `GET /api/v1/check-batches/{id}` returns verbatim, and widening it to include the
          actor relation would change a documented API surface for the sake of a stamp line —
          the objection its own doc comment already records. The batch list says who carried
          each file in, from `listCheckBatches`, which already selects it. */}
      <BatchReport
        fileName={batch.sourceFileName}
        startedAt={{
          iso: batch.startedAt.toISOString(),
          label: formatMinute(batch.startedAt, stampFormat)
        }}
        completedAt={
          batch.completedAt
            ? {
                iso: batch.completedAt.toISOString(),
                label: formatMinute(batch.completedAt, stampFormat)
              }
            : null
        }
        counts={batch.counts}
        rows={rows}
      />
    </>
  );
}
