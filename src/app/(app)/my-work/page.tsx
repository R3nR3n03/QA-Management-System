import { ExecutionLifecycleState, type QamsRole } from "@prisma/client";
import { listFeatureOptions, listProductOptions } from "@/domain/catalogue";
import {
  assignedOpenCaseCount,
  assignedWorkCounts,
  listExecutionsForTester
} from "@/domain/executions";
import { jiraConnectionStatus } from "@/lib/jira-config";
import { readPage, readPageSize, readParam, type ListSearchParams } from "@/ui/list-params";
import { navFor } from "@/ui/navigation";
import { PAGE_SIZE, PAGE_SIZE_OPTIONS } from "@/ui/paging";
import { viewerStampFormat } from "@/ui/format";
import { requireSession } from "@/ui/session";
import { UrlFilterToolbar } from "@/ui/toolbar";
import { FinalizedRecap, readWorkTab, WorkQueue } from "@/ui/work-queue";
import { WorkRail, type RailAction } from "@/ui/work-rail";
import { pickWorkTip } from "@/ui/work-tips";

export const dynamic = "force-dynamic";

/** How many finalized runs the recap shows before deferring to the executions list. */
const RECAP_SIZE = 8;

/**
 * The rail's shortcuts, filtered by what this role may actually reach.
 *
 * Derived from `navigation.ts` rather than hand-written, for the reason that module states:
 * navigation follows the role/capability matrix, and a link a role cannot use is absent
 * rather than present-and-rejecting. A QA Tester authors no test cases and reviews none, so
 * they see neither shortcut — the same two items already missing from their sidebar.
 *
 * "Plan a run" is the exception, and it is the same exception `/dashboard` already makes:
 * planning is not a screen in the matrix but a capability every role holds
 * (`docs/roles-workflows.md:13`), reached from the Executions screen the nav does list.
 */
function railActions(role: QamsRole): RailAction[] {
  const reachable = new Set(navFor(role).map((item) => item.href));
  const actions: RailAction[] = [{ href: "/executions/new", label: "Plan a run", icon: "new-run" }];
  if (reachable.has("/my-work/drafts")) {
    actions.push({ href: "/my-work/drafts", label: "My drafts", icon: "drafts" });
  }
  if (reachable.has("/review")) {
    actions.push({ href: "/review", label: "Review queue", icon: "review" });
  }
  if (reachable.has("/dashboard")) {
    actions.push({ href: "/dashboard", label: "View dashboard", icon: "dashboard" });
  }
  return actions;
}

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

  const [counts, openCases, open, done, products, features] = await Promise.all([
    assignedWorkCounts(auth.userId, scope),
    assignedOpenCaseCount(auth.userId, scope),
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

  /* Deployment configuration, so the page reads it and no component asks for it. It only
     decides whether an UNLINKED run says "No Jira issue"; a recorded key shows either way.
     Same arrangement as the executions list. */
  const jiraConfigured = jiraConnectionStatus().connected;
  const stampFormat = viewerStampFormat(auth);

  /* The rail's tip, chosen from the queue it sits beside. The two row-derived signals read
     the rows actually on screen rather than issuing a query of their own: a tip about
     multi-case runs is worth showing when one is visible, and it is not worth a round trip
     to discover that page 4 has one. The state counts are the whole queue's, because
     "you have a run in progress" is a fact about the queue and not about the page. */
  const tip = pickWorkTip({
    planned: counts.planned,
    inProgress: counts.inProgress,
    hasMultiCaseRun: open.rows.some((execution) => execution.cases.length > 1),
    jiraConfigured,
    hasUnlinkedRun: open.rows.some((execution) => execution.jiraIssueKey === null)
  });

  return (
    <div className="work-screen">
      <div className="page-head work-screen-head">
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
            rather than inside the queue card with the filters that govern only that.

            The Jira key is named in the placeholder because this needle matches it — the
            queue and the executions list share one `executionWhere`. The rows below now show
            the key too, so a match on one is visible in the row it returned rather than
            leaving the reader to guess why it came back. */}
        {query !== "" || counts.open + counts.finalized > 5 ? (
          <UrlFilterToolbar
            placeholder="Search by run, case, or Jira key…"
            label="Search your runs"
            paramKey="q"
          />
        ) : null}
      </div>

      {/* The queue and its recap in one column, the overview and shortcuts in a narrower
          one beside it. Source order is the work first: on a phone the two columns become
          one, and a rail placed first would put four tallies and four links above the rows
          the screen exists for. */}
      <div className="work-screen-main">
        <WorkQueue
          rows={open.rows.map((execution) => ({
            id: execution.id,
            businessId: execution.businessId,
            state: execution.state,
            caseBusinessIds: execution.cases.map((covered) => covered.testCase.businessId),
            purpose: execution.purpose,
            priority: execution.cases[0]?.testCase.priority ?? "",
            jiraIssueKey: execution.jiraIssueKey,
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
          jiraConfigured={jiraConfigured}
          stampFormat={stampFormat}
        />

        <FinalizedRecap
          rows={done.rows.map((execution) => ({
            id: execution.id,
            businessId: execution.businessId,
            result: execution.result,
            caseBusinessIds: execution.cases.map((covered) => covered.testCase.businessId),
            purpose: execution.purpose,
            jiraIssueKey: execution.jiraIssueKey,
            // Per-case outcomes in coverage order, so a multi-case run can say which of its
            // cases passed rather than only its derived worst result.
            caseResults: execution.cases.map((covered) => covered.result),
            finalizedAt: execution.finalizedAt
          }))}
          total={done.total}
          jiraConfigured={jiraConfigured}
          stampFormat={stampFormat}
        />
      </div>

      <WorkRail
        counts={{
          planned: counts.planned,
          inProgress: counts.inProgress,
          finalized: counts.finalized,
          openCases
        }}
        actions={railActions(auth.role)}
        tip={tip}
        params={params}
      />
    </div>
  );
}
