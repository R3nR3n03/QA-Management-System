import Link from "next/link";
import { listExecutionsWithCase } from "@/domain/executions";
import { ExecutionList } from "@/ui/record-list";
import { requireSession } from "@/ui/session";

export const dynamic = "force-dynamic";

/** Every role may view executions (`roles-workflows.md:9`) and plan one (`:13`). */
export default async function ExecutionsPage() {
  await requireSession();
  const rows = await listExecutionsWithCase();

  return (
    <>
      <div className="page-head">
        <h1>Executions</h1>
        <Link className="btn" href="/executions/new">
          Plan execution
        </Link>
      </div>
      <p className="muted" style={{ marginBottom: "var(--sp-4)" }}>
        {rows.length} execution{rows.length === 1 ? "" : "s"}. A finalized run is immutable; a rerun
        is a new execution covering only the failed or blocked case(s).
      </p>

      <ExecutionList
        rows={rows.map((execution) => ({
          id: execution.id,
          businessId: execution.businessId,
          state: execution.state,
          result: execution.result,
          // A run covers one or more cases; a single case keeps its title, several
          // show the count and the full ID list.
          caseBusinessId: execution.cases.map((covered) => covered.testCase.businessId).join(", "),
          caseTitle:
            execution.cases.length === 1
              ? execution.cases[0].testCase.title
              : `${execution.cases.length} test cases`,
          testerName: execution.tester.displayName
        }))}
      />
    </>
  );
}
