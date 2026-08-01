import Link from "next/link";
import { ExecutionLifecycleState } from "@prisma/client";
import { listExecutionsForTester } from "@/domain/executions";
import { ExecutionStateChip, OutcomeChip } from "@/ui/chips";
import { requireSession } from "@/ui/session";

/**
 * A QA Tester's day is "run what I'm assigned", so their front door is a work queue,
 * not a dashboard. Unfinished work sorts first. Rows follow the executions list's
 * treatment: a "N cases" chip plus the first case's ID for multi-case runs.
 *
 * PROPOSAL: `docs/` establishes no home screen for any role (audit section 5.10). What is
 * NOT invented here is who may do what — every action below is gated by the domain
 * service it calls.
 */
export default async function MyWorkPage() {
  const auth = await requireSession();
  const executions = await listExecutionsForTester(auth.userId);

  const open = executions.filter((e) => e.state !== ExecutionLifecycleState.FINALIZED);
  const done = executions.filter((e) => e.state === ExecutionLifecycleState.FINALIZED);

  return (
    <>
      <h1>My work</h1>

      {open.length === 0 ? (
        <div className="card empty" style={{ marginBottom: "var(--sp-6)" }}>
          <p>Nothing is waiting on you right now.</p>
          <Link href="/executions">View all executions</Link>
        </div>
      ) : (
        <>
          <p>
            {open.length} execution{open.length === 1 ? "" : "s"} assigned to you and not yet
            finalized.
          </p>
          <div className="card card-flush" style={{ marginBottom: "var(--sp-6)" }}>
            {open.map((execution) => (
              <div key={execution.id} className="list-row">
                <div className="row-main">
                  <div className="cluster">
                    <span className="bid">{execution.businessId}</span>
                    <ExecutionStateChip state={execution.state} />
                    {execution.cases.length > 1 ? (
                      <span className="state">{execution.cases.length} cases</span>
                    ) : null}
                  </div>
                  <div className="row-title">{execution.cases[0]?.testCase.title}</div>
                  <div className="muted">
                    <span className="bid">{execution.cases[0]?.testCase.businessId}</span>
                    {execution.cases.length > 1 ? ` +${execution.cases.length - 1} more` : ""}
                    {execution.cases.length === 1 ? (
                      <>
                        {" · "}
                        {execution.cases[0].testCase.priority || "no priority"} priority
                      </>
                    ) : null}
                  </div>
                </div>
                <Link className="btn" href={`/executions/${execution.id}`}>
                  {execution.state === ExecutionLifecycleState.PLANNED ? "Start" : "Continue"}
                </Link>
              </div>
            ))}
          </div>
        </>
      )}

      {done.length > 0 ? (
        <>
          <h2>Recently finalized</h2>
          <p className="muted" style={{ marginBottom: "var(--sp-3)" }}>
            Finalized runs are immutable. A rerun creates a new execution covering only the failed
            or blocked case(s).
          </p>
          <div className="card card-flush">
            {done.slice(0, 8).map((execution) => (
              <div key={execution.id} className="list-row">
                <div className="row-main">
                  <div className="cluster">
                    <span className="bid">{execution.businessId}</span>
                    {execution.cases.length > 1 ? (
                      <span className="state">{execution.cases.length} cases</span>
                    ) : null}
                  </div>
                  <div style={{ color: "var(--ink-2)" }}>{execution.cases[0]?.testCase.title}</div>
                </div>
                {execution.result ? <OutcomeChip outcome={execution.result} /> : null}
                <Link className="btn btn-secondary btn-sm" href={`/executions/${execution.id}`}>
                  View
                </Link>
              </div>
            ))}
          </div>
          {done.length > 8 ? (
            <p className="muted" style={{ marginTop: "var(--sp-3)" }}>
              Showing the 8 most recent. <Link href="/executions">View all executions</Link>
            </p>
          ) : null}
        </>
      ) : null}
    </>
  );
}
