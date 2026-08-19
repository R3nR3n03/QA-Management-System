import { QamsRole } from "@prisma/client";
import { notFound } from "next/navigation";
import { listProductOptions } from "@/domain/catalogue";
import { listRecentRunsWithCaseIds, RECENT_RUN_LIMIT } from "@/domain/executions";
import { listApprovedCandidates } from "@/domain/test-cases";
import { readParam, type ListSearchParams } from "@/ui/list-params";
import { requireSession } from "@/ui/session";
import { Breadcrumbs } from "@/ui/breadcrumbs";
import { ContractForm } from "./ContractForm";

export const dynamic = "force-dynamic";

/**
 * Choose the test cases an automation team should name in their specs, and download the
 * contract that says so.
 *
 * A QA Lead capability, like everything else under Automation checks
 * (`docs/roles-workflows.md`) — absent rather than present-and-rejecting for other roles,
 * the same shape `/admin/checks` uses. The engineer who actually writes the specs does not
 * need an account here: what they need is the file, which travels.
 *
 * The document itself is `src/domain/naming-contract.ts`, and it is deliberately not a
 * results file — see the reasoning there.
 */
export default async function NamingContractPage({
  searchParams
}: {
  searchParams: Promise<ListSearchParams>;
}) {
  const params = await searchParams;
  const auth = await requireSession();
  if (auth.role !== QamsRole.QA_LEAD) notFound();

  // Unpaged on purpose: the picker needs every approved candidate, because the selection
  // has to survive filtering. What it RENDERS is bounded by the component.
  const [approved, allProducts, recentRuns] = await Promise.all([
    listApprovedCandidates(),
    listProductOptions(),
    listRecentRunsWithCaseIds()
  ]);

  /*
   * Only products that actually have an Approved case, for the same reason `/executions/new`
   * does it: the picker filters a set that is already in the browser, so offering a product
   * with nothing behind it produces an empty list and no explanation.
   */
  const withCandidates = new Set(approved.map((testCase) => testCase.productId));
  const products = allProducts.filter((product) => withCandidates.has(product.id));

  /*
   * `?cases=` is a preselection, never an instruction — the same rule, and the same wording,
   * as the rerun link into `/executions/new`. An execution's screen links here with the cases
   * it covers so a contract does not have to be reassembled by hand, but a case may have been
   * revised or retired since that run was planned, and only an Approved case belongs in a
   * contract. So the requested ids are intersected with what is actually offerable, and the
   * difference is reported rather than dropped in silence.
   */
  const requested = readParam(params, "cases")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id !== "");
  const offerable = new Set(approved.map((testCase) => testCase.id));
  const preselect = requested.filter((id) => offerable.has(id));
  const unavailable = requested.length - preselect.length;

  /*
   * The same intersection, done once per offered run so the browser holds only ids it can
   * actually select. A run is dropped from the list entirely when NONE of its cases is still
   * offerable: a dead option in a dropdown reads as a broken control, the same reason the
   * product filter above only offers products with a candidate behind them.
   */
  const runs = recentRuns
    .map((run) => {
      const covered = run.cases.map((one) => one.testCaseId);
      const caseIds = covered.filter((id) => offerable.has(id));
      return {
        id: run.id,
        businessId: run.businessId,
        purpose: run.purpose,
        caseIds,
        unavailable: covered.length - caseIds.length
      };
    })
    .filter((run) => run.caseIds.length > 0);

  /* Whether the list may have been cut. Said out loud by the form rather than left implied:
     a capped list presented as complete is the one way this control can mislead. */
  const runsCapped = recentRuns.length === RECENT_RUN_LIMIT;

  return (
    <>
      <Breadcrumbs trail={[{ href: "/admin/checks", label: "Automation checks" }]} here="Naming contract" />
      <h1>Automation naming contract</h1>
      <p className="muted" style={{ marginBottom: "var(--sp-4)" }}>
        The document you hand an automation team so their spec names reach the right test cases.
        A spec reaches a case only by naming its business ID — QAMS stores no link between the
        two — so this is the list of IDs to put in those names. It is not a results file and
        cannot be ingested.
      </p>

      {/* The picker takes a flat candidate rather than a Prisma row, so the page projects
          one — the same projection `/executions/new` makes. */}
      <div className="card">
        <ContractForm
          cases={approved.map((c) => ({
            id: c.id,
            businessId: c.businessId,
            title: c.title,
            priority: c.priority,
            severity: c.severity,
            productId: c.productId,
            featureId: c.featureId,
            featureBusinessId: c.feature.businessId,
            requirementId: c.requirementId,
            requirementBusinessId: c.requirement.businessId,
            moduleName: c.module.name,
            featureName: c.feature.name,
            automation: c.checks[0] ? { outcome: c.checks[0].outcome, count: c._count.checks } : null
          }))}
          products={products.map((p) => ({ id: p.id, businessId: p.businessId, name: p.name }))}
          preselect={preselect}
          unavailable={unavailable}
          runs={runs}
          runsCapped={runsCapped}
        />
      </div>
    </>
  );
}
