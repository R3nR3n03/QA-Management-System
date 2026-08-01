import Link from "next/link";
import { listDefectsWithCase } from "@/domain/defects";
import { DefectList } from "@/ui/record-list";
import { requireSession } from "@/ui/session";

export const dynamic = "force-dynamic";

export default async function DefectsPage() {
  await requireSession();
  const rows = await listDefectsWithCase();

  return (
    <>
      <div className="page-head">
        <h1>Defects</h1>
        <Link className="btn" href="/defects/new">
          New defect
        </Link>
      </div>
      <p className="muted" style={{ marginBottom: "var(--sp-4)" }}>
        {rows.length} defect{rows.length === 1 ? "" : "s"}. No state is ever skipped, and nothing is
        deleted — closure always records its evidence or rationale.
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
      />
    </>
  );
}
