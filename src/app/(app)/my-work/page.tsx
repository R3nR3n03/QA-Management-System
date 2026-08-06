import { ExecutionLifecycleState } from "@prisma/client";
import { listFeatureOptions, listProductOptions } from "@/domain/catalogue";
import { assignedWorkCounts, listExecutionsForTester } from "@/domain/executions";
import { readPage, readPageSize, readParam, type ListSearchParams } from "@/ui/list-params";
import { PAGE_SIZE, PAGE_SIZE_OPTIONS } from "@/ui/paging";
import { requireSession } from "@/ui/session";
import { UrlFilterToolbar } from "@/ui/toolbar";
import { FinalizedRecap, readWorkTab, WorkQueue } from "@/ui/work-queue";

export const dynamic = "force-dynamic";

/** How many finalized runs the recap shows before deferring to the executions list. */
const RECAP_SIZE = 8;

/**
 * A QA Tester's day is "run what I'm assigned", so their front door is a work queue,
 * not a dashboard. Unfinished work sorts first, and the tabs split that queue by the
 * two states it can be in.
 *
 * PROPOSAL: `docs/` establishes no home screen for any role (audit section 5.10). What is
 * NOT invented here is who may do what — every action below is a link to the run's own
 * screen, where the domain service it calls does the gating.
 *
 * The two groups are two queries rather than one full read split with `.filter()`. That
 * is also what makes the open queue's ordering survive paging — see
 * `listExecutionsForTester` on why the lifecycle order is SQL now. The tab tallies are a
 * third query (one `groupBy`, not one count per tab) run under the same filters as the
 * list, so a tab never advertises rows the tab cannot show.
 *
 * Needle, product and feature are all `where` clauses on a read already scoped to the
 * viewer's own runs: narrowing this screen never widens what it can see.
 */
export default async function MyWorkPage({
  searchParams
}: {
  searchParams: Promise<ListSearchParams>;
}) {
  const params = await searchParams;
  const auth = await requireSession();
  const page = readPage(params);
  const pageSize = readPageSize(params, PAGE_SIZE_OPTIONS, PAGE_SIZE);
  const query = readParam(params, "q");
  const tab = readWorkTab(params);
  const productId = readParam(params, "product") || undefined;
  const featureId = readParam(params, "feature") || undefined;
  // "All" is the open queue, not every run: finalized work has its own section below.
  const states =
    tab === "ALL"
      ? [ExecutionLifecycleState.PLANNED, ExecutionLifecycleState.IN_PROGRESS]
      : [tab];
  const scope = { query, productId, featureId };

  const [counts, open, done, products, features] = await Promise.all([
    assignedWorkCounts(auth.userId, scope),
    listExecutionsForTester(auth.userId, { ...scope, page, pageSize, states }),
    // The recap is capped, so it asks for exactly the cap.
    listExecutionsForTester(auth.userId, {
      ...scope,
      page: 1,
      pageSize: RECAP_SIZE,
      states: [ExecutionLifecycleState.FINALIZED]
    }),
    listProductOptions(),
    listFeatureOptions()
  ]);

  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <h1>My work</h1>
          <p className="muted">
            {counts.open === 0
              ? "You have no unfinished runs assigned to you."
              : `${counts.open} run${counts.open === 1 ? "" : "s"} assigned to you and not yet finalized.`}
          </p>
        </div>
        {/* The needle stays on screen once it is set, however few rows match, or there
            would be no way left to clear it — the same rule the record lists follow. It
            searches BOTH lists on this screen, which is why it sits in the page header
            rather than inside the queue card with the filters that govern only that. */}
        {query !== "" || counts.open + counts.finalized > 5 ? (
          <UrlFilterToolbar placeholder="Search your runs…" label="Search your runs" paramKey="q" />
        ) : null}
      </div>

      <WorkQueue
        rows={open.rows.map((execution) => ({
          id: execution.id,
          businessId: execution.businessId,
          state: execution.state,
          caseBusinessIds: execution.cases.map((covered) => covered.testCase.businessId),
          caseTitle: execution.cases[0]?.testCase.title ?? "",
          priority: execution.cases[0]?.testCase.priority ?? "",
          plannedAt: execution.createdAt,
          startedAt: execution.startedAt
        }))}
        total={open.total}
        counts={counts}
        page={page}
        pageSize={pageSize}
        pathname="/my-work"
        params={params}
        products={products}
        features={features}
      />

      <FinalizedRecap
        rows={done.rows.map((execution) => ({
          id: execution.id,
          businessId: execution.businessId,
          result: execution.result,
          caseBusinessIds: execution.cases.map((covered) => covered.testCase.businessId),
          caseTitle: execution.cases[0]?.testCase.title ?? "",
          finalizedAt: execution.finalizedAt
        }))}
        total={done.total}
      />
    </>
  );
}
