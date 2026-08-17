import Link from "next/link";
import { listProductOptions } from "@/domain/catalogue";
import { listDefectsWithCase } from "@/domain/defects";
import { jiraConnectionStatus } from "@/lib/jira-config";
import { readPage, readPageSize, readParam, type ListSearchParams } from "@/ui/list-params";
import { PAGE_SIZE, PAGE_SIZE_OPTIONS } from "@/ui/paging";
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
  const pageSize = readPageSize(params, PAGE_SIZE_OPTIONS, PAGE_SIZE);
  const query = readParam(params, "q");
  const productId = readParam(params, "product");
  const [{ rows, total }, products] = await Promise.all([
    listDefectsWithCase({ page, pageSize, query, productId: productId || undefined }),
    listProductOptions()
  ]);
  const productName = products.find((row) => row.id === productId)?.name;

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
        {query ? ` matching “${query}”` : ""}
        {/* "against" not "in": a defect belongs to a product only through the case it
            was raised against. */}
        {productName ? ` against ${productName}` : ""}. No state is ever skipped, and nothing is
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
          caseBusinessId: defect.testCase.businessId,
          jiraIssueKey: defect.jiraIssueKey,
          // Per row, from the product the defect reaches through its test case — not one
          // flag for the screen. Two defects in one list can legitimately disagree: a
          // product with a Jira project owes a bug, one without owes nothing.
          jiraExpected: defect.testCase.product.jiraProjectKey !== null
        }))}
        total={total}
        page={page}
        pageSize={pageSize}
        pathname="/defects"
        params={params}
        products={products}
        jiraConfigured={jiraConnectionStatus().connected}
      />
    </>
  );
}
