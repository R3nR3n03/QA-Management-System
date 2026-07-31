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
      <div style={{ display: "flex", alignItems: "baseline", gap: "var(--sp-4)", flexWrap: "wrap" }}>
        <h1 style={{ flex: 1 }}>Executions</h1>
        <Link className="btn" href="/executions/new">
          Plan execution
        </Link>
      </div>
      <p className="muted" style={{ marginBottom: "var(--sp-4)" }}>
        {rows.length} execution{rows.length === 1 ? "" : "s"}. A finalized run is immutable; a rerun
        is a new execution against the same approved case.
      </p>

      <ExecutionList
        rows={rows.map((execution) => ({
          id: execution.id,
          businessId: execution.businessId,
          state: execution.state,
          result: execution.result,
          caseBusinessId: execution.testCase.businessId,
          caseTitle: execution.testCase.title,
          testerName: execution.tester.displayName
        }))}
      />
    </>
  );
}
