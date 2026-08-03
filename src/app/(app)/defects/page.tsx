import Link from "next/link";
import { listDefectsWithCase } from "@/domain/defects";
import { readPage, readParam, type ListSearchParams } from "@/ui/list-params";
import { DefectList } from "@/ui/record-list";
import { requireSession } from "@/ui/session";

export const dynamic = "force-dynamic";

export default async function DefectsPage({
  searchParams
}: {
  searchParams: Promise<ListSearchParams>;
}) {
  const params = await searchParams;
  await requireSession();
  const page = readPage(params);
  const query = readParam(params, "q");
  const { rows, total } = await listDefectsWithCase({ page, query });

  return (
    <>
      <div className="page-head">
        <h1>Defects</h1>
        <Link className="btn" href="/defects/new">
          New defect
        </Link>
      </div>
      <p className="muted" style={{ marginBottom: "var(--sp-4)" }}>
        {total} defect{total === 1 ? "" : "s"}
        {query ? ` matching “${query}”` : ""}. No state is ever skipped, and nothing is deleted —
        closure always records its evidence or rationale.
      </p>

      <DefectList
        rows={rows.map((defect) => ({
          id: defect.id,
          businessId: defect.businessId,
          status: defect.status,
          summary: defect.summary,
          priority: defect.priority,
          severity: defect.severity,
          caseBusinessId: defect.testCase.businessId
        }))}
        total={total}
        page={page}
        pathname="/defects"
        params={params}
      />
    </>
  );
}
