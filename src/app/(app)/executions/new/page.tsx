import { TestCaseLifecycleState } from "@prisma/client";
import { listAssignableTesters } from "@/domain/executions";
import { listTestCases } from "@/domain/test-cases";
import { requireSession } from "@/ui/session";
import { PlanForm } from "./PlanForm";

export const dynamic = "force-dynamic";

export default async function PlanExecutionPage() {
  await requireSession();
  // Unpaged on purpose: the picker needs every approved candidate. "Approved" is a
  // `where` now rather than a filter over every test case in the system.
  const [{ rows: approved }, testers] = await Promise.all([
    listTestCases({ states: [TestCaseLifecycleState.APPROVED] }),
    listAssignableTesters()
  ]);

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
          />
        )}
      </div>
    </>
  );
}
