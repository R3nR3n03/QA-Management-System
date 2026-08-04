import { TestCaseLifecycleState } from "@prisma/client";
import { listProductOptions } from "@/domain/catalogue";
import { listTestCases } from "@/domain/test-cases";
import { CaseTable } from "@/ui/case-table";
import { readPage, readPageSize, readParam, type ListSearchParams } from "@/ui/list-params";
import { PAGE_SIZE, PAGE_SIZE_OPTIONS } from "@/ui/paging";
import { requireSession } from "@/ui/session";

export const dynamic = "force-dynamic";

/**
 * Everything In Review. Own-authored cases are listed too — the reviewer needs to see
 * the whole queue — but approving one's own case is refused by the domain
 * (`roles-workflows.md:26`, enforced in `approveTestCase`), and the detail screen
 * says so before the button.
 *
 * The In Review restriction is now a `where` on the query, not a `.filter()` over every
 * test case in the system.
 */
export default async function ReviewQueuePage({
  searchParams
}: {
  searchParams: Promise<ListSearchParams>;
}) {
  const params = await searchParams;
  await requireSession();
  const page = readPage(params);
  const pageSize = readPageSize(params, PAGE_SIZE_OPTIONS, PAGE_SIZE);
  // A queue is worked one area at a time, so it gets the same product scope the full
  // list has. The state restriction stays a `where` and the product joins it there,
  // rather than either being re-applied over a page of rows.
  const productId = readParam(params, "product");
  const [{ rows, total }, products] = await Promise.all([
    listTestCases({
      page,
      pageSize,
      query: readParam(params, "q"),
      states: [TestCaseLifecycleState.IN_REVIEW],
      productId: productId || undefined
    }),
    listProductOptions()
  ]);
  const productName = products.find((row) => row.id === productId)?.name;

  return (
    <>
      <h1>Review queue</h1>
      <p className="muted" style={{ marginBottom: "var(--sp-4)" }}>
        {total === 0
          ? `Nothing${productName ? ` in ${productName}` : ""} is waiting for review.`
          : `${total} case${total === 1 ? "" : "s"}${productName ? ` in ${productName}` : ""} waiting for a reviewer. An author cannot approve their own case.`}
      </p>
      <CaseTable
        rows={rows}
        total={total}
        page={page}
        pageSize={pageSize}
        pathname="/review"
        params={params}
        emptyText="Nothing is waiting for review."
        products={products}
        // This screen is already scoped to In Review, so the default — "no test case
        // belongs to this product" — would be false of a product with plenty of cases
        // and none of them in the queue.
        productEmptyText="Nothing in this product is waiting for review."
      />
    </>
  );
}
