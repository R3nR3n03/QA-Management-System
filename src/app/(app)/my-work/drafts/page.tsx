import Link from "next/link";
import { TestCaseLifecycleState } from "@prisma/client";
import { listTestCases } from "@/domain/test-cases";
import { CaseTable } from "@/ui/case-table";
import { requireSession } from "@/ui/session";

export const dynamic = "force-dynamic";

/**
 * An author's in-flight work: their own Draft and In Review cases. A QA Engineer may
 * submit only their own cases (`roles-workflows.md:11`), so "mine" is the natural
 * scope; what they may do with each row stays enforced in the domain.
 */
export default async function MyDraftsPage() {
  const auth = await requireSession();
  const rows = (await listTestCases()).filter(
    (row) =>
      row.authorUserId === auth.userId &&
      (row.lifecycleState === TestCaseLifecycleState.DRAFT ||
        row.lifecycleState === TestCaseLifecycleState.IN_REVIEW)
  );

  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", gap: "var(--sp-4)", flexWrap: "wrap" }}>
        <h1 style={{ flex: 1 }}>My drafts</h1>
        <Link className="btn" href="/test-cases/new">
          New draft
        </Link>
      </div>
      <p className="muted" style={{ marginBottom: "var(--sp-4)" }}>
        Your cases still in Draft or In Review. A case needs at least one step before it can be
        submitted.
      </p>
      <CaseTable rows={rows} emptyText="You have no drafts in flight." />
    </>
  );
}
