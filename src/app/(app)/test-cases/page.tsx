import Link from "next/link";
import { QamsRole } from "@prisma/client";
import { listFeatureOptions, listProductOptions } from "@/domain/catalogue";
import { listTestCases } from "@/domain/test-cases";
import { CaseTable } from "@/ui/case-table";
import { readPage, readPageSize, readParam, type ListSearchParams } from "@/ui/list-params";
import { PAGE_SIZE, PAGE_SIZE_OPTIONS } from "@/ui/paging";
import { requireSession } from "@/ui/session";

export const dynamic = "force-dynamic";

/** Every role may view test cases (`roles-workflows.md:9`); authoring starts here. */
export default async function TestCasesPage({
  searchParams
}: {
  searchParams: Promise<ListSearchParams>;
}) {
  const params = await searchParams;
  const auth = await requireSession();
  const page = readPage(params);
  const pageSize = readPageSize(params, PAGE_SIZE_OPTIONS, PAGE_SIZE);
  const query = readParam(params, "q");
  const productId = readParam(params, "product");
  const featureId = readParam(params, "feature");
  // One page of rows plus the matching count — never the whole table.
  const [{ rows, total }, products, features] = await Promise.all([
    listTestCases({
      page,
      pageSize,
      query,
      productId: productId || undefined,
      featureId: featureId || undefined
    }),
    listProductOptions(),
    listFeatureOptions()
  ]);
  const productName = products.find((row) => row.id === productId)?.name;
  const featureName = features.find((row) => row.id === featureId)?.name;
  const scopeParts = [productName, featureName].filter(Boolean);
  const mayAuthor = auth.role !== QamsRole.QA_TESTER;

  return (
    <>
      <div className="page-head">
        <h1>Test cases</h1>
        {mayAuthor ? (
          <Link className="btn" href="/test-cases/new">
            New draft
          </Link>
        ) : null}
      </div>
      <p className="muted" style={{ marginBottom: "var(--sp-4)" }}>
        {total} test case{total === 1 ? "" : "s"}
        {query ? ` matching “${query}”` : ""}
        {scopeParts.length > 0 ? ` in ${scopeParts.join(" · ")}` : ""}. Approved content is
        immutable — a material change is a new Draft revision.
      </p>
      <CaseTable
        rows={rows}
        total={total}
        page={page}
        pageSize={pageSize}
        pathname="/test-cases"
        params={params}
        products={products}
        features={features}
        // The empty state's whole job is naming the next step, so it has to name one
        // this viewer can actually take. Unconditionally it told a QA Tester to create a
        // draft (authors only) and to import the workbook (Lead only), with neither
        // control on screen for them — the "New draft" button above is already gated.
        emptyText={
          mayAuthor
            ? "No test cases yet. Create a draft to get started."
            : "No test cases yet. A QA Engineer or Lead adds them."
        }
      />
    </>
  );
}
