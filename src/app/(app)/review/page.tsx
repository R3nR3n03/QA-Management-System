import { TestCaseLifecycleState } from "@prisma/client";
import { listTestCases } from "@/domain/test-cases";
import { CaseTable } from "@/ui/case-table";
import { readPage, readParam, type ListSearchParams } from "@/ui/list-params";
import { requireSession } from "@/ui/session";

export const dynamic = "force-dynamic";

/**
 * Everything In Review. Own-authored cases are listed too — the reviewer needs to see
 * the whole queue — but approving one's own case is refused by the domain
 * (`roles-workflows.md:26`, enforced in `approveTestCase`), and the detail screen
 * says so before the button.
 *
 * The In Review restriction is now a `where` on the query, not a `.filter()` over every
 * test case in the system.
 */
export default async function ReviewQueuePage({
  searchParams
}: {
  searchParams: Promise<ListSearchParams>;
}) {
  const params = await searchParams;
  await requireSession();
  const page = readPage(params);
  const { rows, total } = await listTestCases({
    page,
    query: readParam(params, "q"),
    states: [TestCaseLifecycleState.IN_REVIEW]
  });

  return (
    <>
      <h1>Review queue</h1>
      <p className="muted" style={{ marginBottom: "var(--sp-4)" }}>
        {total === 0
          ? "Nothing is waiting for review."
          : `${total} case${total === 1 ? "" : "s"} waiting for a reviewer. An author cannot approve their own case.`}
      </p>
      <CaseTable
        rows={rows}
        total={total}
        page={page}
        pathname="/review"
        params={params}
        emptyText="Nothing is waiting for review."
      />
    </>
  );
}
