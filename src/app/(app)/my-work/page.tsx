import Link from "next/link";
import { ExecutionLifecycleState } from "@prisma/client";
import { listExecutionsForTester } from "@/domain/executions";
import { ExecutionStateChip, OutcomeChip } from "@/ui/chips";
import { readPage, type ListSearchParams } from "@/ui/list-params";
import { Pager } from "@/ui/pager";
import { requireSession } from "@/ui/session";

/**
 * A QA Tester's day is "run what I'm assigned", so their front door is a work queue,
 * not a dashboard. Unfinished work sorts first. Rows follow the executions list's
 * treatment: a "N cases" chip plus the first case's ID for multi-case runs.
 *
 * PROPOSAL: `docs/` establishes no home screen for any role (audit section 5.10). What is
 * NOT invented here is who may do what — every action below is gated by the domain
 * service it calls.
 *
 * The two groups are two queries rather than one full read split with `.filter()`. That
 * is also what makes the open queue's ordering survive paging — see
 * `listExecutionsForTester` on why the lifecycle order is SQL now.
 */
export default async function MyWorkPage({
  searchParams
}: {
  searchParams: Promise<ListSearchParams>;
}) {
  const params = await searchParams;
  const auth = await requireSession();
  const page = readPage(params);

  const [open, done] = await Promise.all([
    listExecutionsForTester(auth.userId, {
      page,
      states: [ExecutionLifecycleState.PLANNED, ExecutionLifecycleState.IN_PROGRESS]
    }),
    // The recap is capped at 8 by the copy below, so it asks for exactly 8.
    listExecutionsForTester(auth.userId, {
      page: 1,
      pageSize: 8,
      states: [ExecutionLifecycleState.FINALIZED]
    })
  ]);

  return (
    <>
      <h1>My work</h1>

      {open.total === 0 ? (
        <div className="card empty" style={{ marginBottom: "var(--sp-6)" }}>
          <p>Nothing is waiting on you right now.</p>
          <Link href="/executions">View all executions</Link>
        </div>
      ) : (
        <>
          <p>
            {open.total} execution{open.total === 1 ? "" : "s"} assigned to you and not yet
            finalized.
          </p>
          <div className="card card-flush" style={{ marginBottom: "var(--sp-6)" }}>
            {open.rows.map((execution) => (
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
            <Pager
              total={open.total}
              page={page}
              pathname="/my-work"
              params={params}
              label="open work queue"
            />
          </div>
        </>
      )}

      {done.total > 0 ? (
        <>
          <h2>Recently finalized</h2>
          <p className="muted" style={{ marginBottom: "var(--sp-3)" }}>
            Finalized runs are immutable. A rerun creates a new execution covering only the failed
            or blocked case(s).
          </p>
          <div className="card card-flush">
            {done.rows.map((execution) => (
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
          {done.total > 8 ? (
            <p className="muted" style={{ marginTop: "var(--sp-3)" }}>
              Showing the 8 most recent. <Link href="/executions">View all executions</Link>
            </p>
          ) : null}
        </>
      ) : null}
    </>
  );
}
