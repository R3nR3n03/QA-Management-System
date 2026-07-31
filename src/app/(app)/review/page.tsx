import { TestCaseLifecycleState } from "@prisma/client";
import { listTestCases } from "@/domain/test-cases";
import { CaseTable } from "@/ui/case-table";
import { requireSession } from "@/ui/session";

export const dynamic = "force-dynamic";

/**
 * Everything In Review. Own-authored cases are listed too — the reviewer needs to see
 * the whole queue — but approving one's own case is refused by the domain
 * (`roles-workflows.md:26`, enforced in `approveTestCase`), and the detail screen
 * says so before the button.
 */
export default async function ReviewQueuePage() {
  await requireSession();
  const rows = (await listTestCases()).filter(
    (row) => row.lifecycleState === TestCaseLifecycleState.IN_REVIEW
  );

  return (
    <>
      <h1>Review queue</h1>
      <p className="muted" style={{ marginBottom: "var(--sp-4)" }}>
        {rows.length === 0
          ? "Nothing is waiting for review."
          : `${rows.length} case${rows.length === 1 ? "" : "s"} waiting for a reviewer. An author cannot approve their own case.`}
      </p>
      <CaseTable rows={rows} emptyText="Nothing is waiting for review." />
    </>
  );
}
