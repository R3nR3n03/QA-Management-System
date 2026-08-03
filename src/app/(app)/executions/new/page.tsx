import { TestCaseLifecycleState } from "@prisma/client";
import { listAssignableTesters } from "@/domain/executions";
import { listTestCases } from "@/domain/test-cases";
import { readParam, type ListSearchParams } from "@/ui/list-params";
import { requireSession } from "@/ui/session";
import { PlanForm } from "./PlanForm";

export const dynamic = "force-dynamic";

export default async function PlanExecutionPage({
  searchParams
}: {
  searchParams: Promise<ListSearchParams>;
}) {
  const params = await searchParams;
  await requireSession();
  // Unpaged on purpose: the picker needs every approved candidate. "Approved" is a
  // `where` now rather than a filter over every test case in the system.
  const [{ rows: approved }, testers] = await Promise.all([
    listTestCases({ states: [TestCaseLifecycleState.APPROVED] }),
    listAssignableTesters()
  ]);

  /*
   * `?cases=` is a preselection, never an instruction. A finalized run links here with
   * its failed and blocked cases so a rerun does not have to be reassembled by hand —
   * but a case may have been revised or retired since that run closed, and only an
   * Approved case can be executed (`docs/data-model.md:47`). So the requested ids are
   * intersected with what is actually offerable, and the difference is reported rather
   * than dropped in silence: a rerun that quietly covers fewer cases than it was asked
   * to is the failure mode worth spending a sentence on.
   */
  const requested = readParam(params, "cases")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id !== "");
  const offerable = new Set(approved.map((testCase) => testCase.id));
  const preselect = requested.filter((id) => offerable.has(id));
  const unavailable = requested.length - preselect.length;

  return (
    <>
      <h1>Plan an execution</h1>
      <p className="muted" style={{ marginBottom: "var(--sp-4)" }}>
        A planned run starts in Planned and waits in the assigned tester&rsquo;s queue.
      </p>
      <div className="card">
        {approved.length === 0 ? (
          <div className="empty">
            <p>There are no approved test cases yet — only an Approved case can be executed.</p>
          </div>
        ) : (
          <PlanForm
            cases={approved.map((c) => ({ id: c.id, businessId: c.businessId, title: c.title }))}
            testers={testers.map((t) => ({ id: t.id, displayName: t.displayName }))}
            preselect={preselect}
            unavailable={unavailable}
          />
        )}
      </div>
    </>
  );
}
