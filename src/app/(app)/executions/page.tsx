import Link from "next/link";
import { ExecutionLifecycleState } from "@prisma/client";
import { listProductOptions } from "@/domain/catalogue";
import { listExecutionsWithCase } from "@/domain/executions";
import { readPage, readPageSize, readParam, type ListSearchParams } from "@/ui/list-params";
import { PAGE_SIZE, PAGE_SIZE_OPTIONS } from "@/ui/paging";
import { ExecutionList } from "@/ui/record-list";
import { requireSession } from "@/ui/session";

export const dynamic = "force-dynamic";

/** Only a value the enum actually has becomes a filter; anything else is ignored. */
function stateFilter(raw: string): ExecutionLifecycleState[] | undefined {
  const match = Object.values(ExecutionLifecycleState).find((state) => state === raw);
  return match ? [match] : undefined;
}

/** Every role may view executions (`roles-workflows.md:9`) and plan one (`:13`). */
export default async function ExecutionsPage({
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
    listExecutionsWithCase({
      page,
      pageSize,
      query,
      productId: productId || undefined,
      states: stateFilter(readParam(params, "state"))
    }),
    listProductOptions()
  ]);
  const productName = products.find((row) => row.id === productId)?.name;

  return (
    <>
      <div className="page-head">
        <h1>Executions</h1>
        <Link className="btn" href="/executions/new">
          Plan execution
        </Link>
      </div>
      <p className="muted" style={{ marginBottom: "var(--sp-4)" }}>
        {total} execution{total === 1 ? "" : "s"}
        {query ? ` matching “${query}”` : ""}
        {/* "covering" not "in": a run belongs to no product of its own, it only reaches
            one through the cases it covers, and a multi-case run can span two. */}
        {productName ? ` covering ${productName}` : ""}. A finalized run is immutable; a rerun is
        a new execution covering only the failed or blocked case(s).
      </p>

      <ExecutionList
        rows={rows.map((execution) => ({
          id: execution.id,
          businessId: execution.businessId,
          state: execution.state,
          result: execution.result,
          // A run covers one or more cases; the list shows the first case's title and
          // renders a "N cases" chip plus "+n more" for the rest.
          caseBusinessIds: execution.cases.map((covered) => covered.testCase.businessId),
          caseTitle: execution.cases[0]?.testCase.title ?? "",
          testerName: execution.tester.displayName,
          // Per-case outcomes in the same coverage order, so a multi-case run can say
          // which of its cases passed rather than only its derived worst result.
          caseResults: execution.cases.map((covered) => covered.result),
          plannedAt: execution.createdAt,
          startedAt: execution.startedAt,
          finalizedAt: execution.finalizedAt
        }))}
        total={total}
        page={page}
        pageSize={pageSize}
        pathname="/executions"
        params={params}
        products={products}
      />
    </>
  );
}
