import Link from "next/link";
import { ExecutionLifecycleState } from "@prisma/client";
import { listExecutionsForTester } from "@/domain/executions";
import { ExecutionStateChip, OutcomeChip } from "@/ui/chips";
import { requireSession } from "@/ui/session";

/**
 * A QA Tester's day is "run what I'm assigned", so their front door is a work queue,
 * not a dashboard. Unfinished work sorts first.
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
      <p>
        {open.length === 0
          ? "Nothing is waiting on you right now."
          : `${open.length} execution${open.length === 1 ? "" : "s"} assigned to you and not yet finalized.`}
      </p>

      {open.length > 0 ? (
        <div className="card card-flush" style={{ marginBottom: "var(--sp-6)" }}>
          {open.map((execution) => (
            <div key={execution.id} className="list-row">
              <div className="row-main">
                <div className="cluster">
                  <span className="bid">{execution.businessId}</span>
                  <ExecutionStateChip state={execution.state} />
                </div>
                <div className="row-title">{execution.testCase.title}</div>
                <div className="muted">
                  <span className="bid">{execution.testCase.businessId}</span>
                  {" · "}
                  {execution.testCase.priority || "no priority"} priority
                </div>
              </div>
              <Link className="btn" href={`/executions/${execution.id}`}>
                {execution.state === ExecutionLifecycleState.PLANNED ? "Start" : "Continue"}
              </Link>
            </div>
          ))}
        </div>
      ) : null}

      {done.length > 0 ? (
        <>
          <h2>Recently finalized</h2>
          <p className="muted" style={{ marginBottom: "var(--sp-3)" }}>
            Finalized runs are immutable. A rerun creates a new execution against the same approved
            test case.
          </p>
          <div className="card card-flush">
            {done.slice(0, 8).map((execution) => (
              <div key={execution.id} className="list-row">
                <div className="row-main">
                  <span className="bid">{execution.businessId}</span>
                  <div style={{ color: "var(--ink-2)" }}>{execution.testCase.title}</div>
                </div>
                {execution.result ? <OutcomeChip outcome={execution.result} /> : null}
                <Link href={`/executions/${execution.id}`} style={{ fontSize: 14 }}>
                  View
                </Link>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}
