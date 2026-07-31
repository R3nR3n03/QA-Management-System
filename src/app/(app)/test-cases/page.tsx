import Link from "next/link";
import { QamsRole } from "@prisma/client";
import { listTestCases } from "@/domain/test-cases";
import { CaseTable } from "@/ui/case-table";
import { requireSession } from "@/ui/session";

export const dynamic = "force-dynamic";

/** Every role may view test cases (`roles-workflows.md:9`); authoring starts here. */
export default async function TestCasesPage() {
  const auth = await requireSession();
  const rows = await listTestCases();
  const mayAuthor = auth.role !== QamsRole.QA_TESTER;

  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", gap: "var(--sp-4)", flexWrap: "wrap" }}>
        <h1 style={{ flex: 1 }}>Test cases</h1>
        {mayAuthor ? (
          <Link className="btn" href="/test-cases/new">
            New draft
          </Link>
        ) : null}
      </div>
      <p className="muted" style={{ marginBottom: "var(--sp-4)" }}>
        {rows.length} test case{rows.length === 1 ? "" : "s"}. Approved content is immutable — a
        material change is a new Draft revision.
      </p>
      <CaseTable rows={rows} emptyText="No test cases yet. Import the workbook or create a draft." />
    </>
  );
}
