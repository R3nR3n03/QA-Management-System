import Link from "next/link";
import { QamsRole } from "@prisma/client";
import { listTestCases } from "@/domain/test-cases";
import { CaseTable } from "@/ui/case-table";
import { readPage, readParam, type ListSearchParams } from "@/ui/list-params";
import { requireSession } from "@/ui/session";

export const dynamic = "force-dynamic";

/** Every role may view test cases (`roles-workflows.md:9`); authoring starts here. */
export default async function TestCasesPage({
  searchParams
}: {
  searchParams: Promise<ListSearchParams>;
}) {
  const params = await searchParams;
  const auth = await requireSession();
  const page = readPage(params);
  const query = readParam(params, "q");
  // One page of rows plus the matching count — never the whole table.
  const { rows, total } = await listTestCases({ page, query });
  const mayAuthor = auth.role !== QamsRole.QA_TESTER;

  return (
    <>
      <div className="page-head">
        <h1>Test cases</h1>
        {mayAuthor ? (
          <Link className="btn" href="/test-cases/new">
            New draft
          </Link>
        ) : null}
      </div>
      <p className="muted" style={{ marginBottom: "var(--sp-4)" }}>
        {total} test case{total === 1 ? "" : "s"}
        {query ? ` matching “${query}”` : ""}. Approved content is immutable — a material change is
        a new Draft revision.
      </p>
      <CaseTable
        rows={rows}
        total={total}
        page={page}
        pathname="/test-cases"
        params={params}
        emptyText="No test cases yet. Import the workbook or create a draft."
      />
    </>
  );
}
