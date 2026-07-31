import Link from "next/link";
import { listExecutionsWithCase } from "@/domain/executions";
import { ExecutionStateChip, OutcomeChip } from "@/ui/chips";
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

      {rows.length === 0 ? (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>No executions yet. Plan one against an approved test case.</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          {rows.map((execution) => (
            <div
              key={execution.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--sp-4)",
                padding: "var(--sp-3) var(--sp-5)",
                borderBottom: "1px solid var(--line-soft)",
                flexWrap: "wrap"
              }}
            >
              <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", flexWrap: "wrap" }}>
                  <span className="bid">{execution.businessId}</span>
                  <ExecutionStateChip state={execution.state} />
                  {execution.result ? <OutcomeChip outcome={execution.result} /> : null}
                </div>
                <div style={{ fontWeight: 600, color: "var(--ink)", marginTop: 2 }}>
                  {execution.testCase.title}
                </div>
                <div className="muted">
                  <span className="bid">{execution.testCase.businessId}</span>
                  {" · "}
                  {execution.tester.displayName}
                </div>
              </div>
              <Link href={`/executions/${execution.id}`} style={{ fontSize: 14 }}>
                View
              </Link>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
