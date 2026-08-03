import Link from "next/link";
import { TestCaseLifecycleState } from "@prisma/client";
import { listTestCases } from "@/domain/test-cases";
import { CaseTable } from "@/ui/case-table";
import { readPage, readParam, type ListSearchParams } from "@/ui/list-params";
import { requireSession } from "@/ui/session";

export const dynamic = "force-dynamic";

/**
 * An author's in-flight work: their own Draft and In Review cases. A QA Engineer may
 * submit only their own cases (`roles-workflows.md:11`), so "mine" is the natural
 * scope; what they may do with each row stays enforced in the domain.
 *
 * Both restrictions — author and state — are `where` clauses now, so this reads only
 * the author's own rows rather than every test case in the system.
 */
export default async function MyDraftsPage({
  searchParams
}: {
  searchParams: Promise<ListSearchParams>;
}) {
  const params = await searchParams;
  const auth = await requireSession();
  const page = readPage(params);
  const { rows, total } = await listTestCases({
    page,
    query: readParam(params, "q"),
    authorUserId: auth.userId,
    states: [TestCaseLifecycleState.DRAFT, TestCaseLifecycleState.IN_REVIEW]
  });

  return (
    <>
      <div className="page-head">
        <h1>My drafts</h1>
        <Link className="btn" href="/test-cases/new">
          New draft
        </Link>
      </div>
      <p className="muted" style={{ marginBottom: "var(--sp-4)" }}>
        Your cases still in Draft or In Review. A case needs at least one step before it can be
        submitted.
      </p>
      <CaseTable
        rows={rows}
        total={total}
        page={page}
        pathname="/my-work/drafts"
        params={params}
        emptyText="You have no drafts in flight."
      />
    </>
  );
}
