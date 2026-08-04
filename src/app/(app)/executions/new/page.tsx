import { listProductOptions } from "@/domain/catalogue";
import { listAssignableTesters, openExecutionCountsByTester } from "@/domain/executions";
import { listApprovedCandidates } from "@/domain/test-cases";
import { readParam, type ListSearchParams } from "@/ui/list-params";
import { requireSession } from "@/ui/session";
import { PlanForm } from "./PlanForm";

export const dynamic = "force-dynamic";

export default async function PlanExecutionPage({
  searchParams
}: {
  searchParams: Promise<ListSearchParams>;
}) {
  const params = await searchParams;
  await requireSession();
  // Unpaged on purpose: the picker needs every approved candidate, because the selection
  // has to survive filtering. What it RENDERS is bounded by the form.
  const [approved, testers, openRuns, allProducts] = await Promise.all([
    listApprovedCandidates(),
    listAssignableTesters(),
    openExecutionCountsByTester(),
    listProductOptions()
  ]);

  /*
   * Only products that actually have an Approved case. The picker filters a set that is
   * already in the browser, so offering a product with nothing to offer would produce an
   * empty list and no explanation — a dead option in a dropdown reads as a broken filter.
   */
  const withCandidates = new Set(approved.map((testCase) => testCase.productId));
  const products = allProducts.filter((product) => withCandidates.has(product.id));

  /*
   * `?cases=` is a preselection, never an instruction. A finalized run links here with
   * its failed and blocked cases so a rerun does not have to be reassembled by hand —
   * but a case may have been revised or retired since that run closed, and only an
   * Approved case can be executed (`docs/data-model.md:47`). So the requested ids are
   * intersected with what is actually offerable, and the difference is reported rather
   * than dropped in silence: a rerun that quietly covers fewer cases than it was asked
   * to is the failure mode worth spending a sentence on.
   */
  const requested = readParam(params, "cases")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id !== "");
  const offerable = new Set(approved.map((testCase) => testCase.id));
  const preselect = requested.filter((id) => offerable.has(id));
  const unavailable = requested.length - preselect.length;

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
            cases={approved.map((c) => ({
              id: c.id,
              businessId: c.businessId,
              title: c.title,
              priority: c.priority,
              severity: c.severity,
              productId: c.productId,
              moduleName: c.module.name,
              featureName: c.feature.name
            }))}
            products={products.map((p) => ({ id: p.id, businessId: p.businessId, name: p.name }))}
            testers={testers.map((t) => ({
              id: t.id,
              displayName: t.displayName,
              // Absent from the groupBy means no open runs, not missing data.
              openRuns: openRuns.get(t.id) ?? 0
            }))}
            preselect={preselect}
            unavailable={unavailable}
          />
        )}
      </div>
    </>
  );
}
