import Link from "next/link";
import { ExecutionLifecycleState } from "@prisma/client";
import { listExecutionsWithCase } from "@/domain/executions";
import { readPage, readParam, type ListSearchParams } from "@/ui/list-params";
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
  const query = readParam(params, "q");
  const { rows, total } = await listExecutionsWithCase({
    page,
    query,
    states: stateFilter(readParam(params, "state"))
  });

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
        {query ? ` matching “${query}”` : ""}. A finalized run is immutable; a rerun is a new
        execution covering only the failed or blocked case(s).
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
          testerName: execution.tester.displayName
        }))}
        total={total}
        page={page}
        pathname="/executions"
        params={params}
      />
    </>
  );
}
