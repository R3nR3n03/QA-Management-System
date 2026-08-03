import { ExecutionOutcome, QamsRole } from "@prisma/client";
import { notFound } from "next/navigation";
import { listProducts } from "@/domain/catalogue";
import { releaseReadinessSnapshot } from "@/domain/traceability";
import { AppError } from "@/lib/errors";
import { OutcomeChip } from "@/ui/chips";
import { errorCopy } from "@/ui/error-copy";
import { requireSession } from "@/ui/session";

export const dynamic = "force-dynamic";

/**
 * Advisory only, and the screen says so with the numbers: the knowledge base defines
 * no pass-rate thresholds or severity gates (`roles-workflows.md:58`), so nothing
 * here is coloured "ready" or "not ready". The QA Lead records the decision and
 * rationale separately; this report is the evidence, not the verdict.
 *
 * A plain GET form: the scope lives in the URL, so a snapshot can be shared by link
 * and re-rendered fresh each time.
 */
export default async function ReleaseReadinessPage({
  searchParams
}: {
  searchParams: Promise<{ productId?: string; release?: string; environment?: string }>;
}) {
  const auth = await requireSession();
  // Lead-only screen: absent rather than present-and-rejecting for other roles
  // (the domain services behind it refuse them regardless).
  if (auth.role !== QamsRole.QA_LEAD) notFound();
  const { productId = "", release = "", environment = "" } = await searchParams;
  // Unpaged on purpose: this fills the report's product <select>, which needs every option.
  const { rows: products } = await listProducts();

  let snapshot: Awaited<ReturnType<typeof releaseReadinessSnapshot>> | null = null;
  let failure: { title: string; detail: string } | null = null;

  if (productId && release && environment) {
    try {
      snapshot = await releaseReadinessSnapshot({ productId, release, environment }, auth.role);
    } catch (error) {
      if (error instanceof AppError) {
        const copy = errorCopy(error.code, error.field);
        failure = { title: copy.title, detail: copy.detail };
      } else {
        throw error;
      }
    }
  }

  return (
    <>
      <h1>Release readiness</h1>
      <p className="muted" style={{ marginBottom: "var(--sp-4)" }}>
        Pick the scope; the report shows finalized executions, open defects, and requirements
        without trace links for the approved cases in it.
      </p>

      <div className="card" style={{ marginBottom: "var(--sp-5)" }}>
        <form method="get" className="row" style={{ alignItems: "flex-end" }}>
          <label className="field" style={{ flex: "2 1 220px", marginBottom: 0 }}>
            <span>Product</span>
            <select name="productId" defaultValue={productId} required>
              <option value="" disabled>
                Choose…
              </option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.businessId} · {product.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field" style={{ flex: "1 1 120px", marginBottom: 0 }}>
            <span>Release</span>
            <input name="release" defaultValue={release} required />
          </label>
          <label className="field" style={{ flex: "1 1 120px", marginBottom: 0 }}>
            <span>Environment</span>
            <input name="environment" defaultValue={environment} required />
          </label>
          <button className="btn" type="submit">
            Report
          </button>
        </form>
      </div>

      {failure ? (
        <div className="notice" role="alert">
          <strong>{failure.title}</strong>
          <span>{failure.detail}</span>
        </div>
      ) : null}

      {snapshot ? (
        <>
          <p className="notice notice-advisory" style={{ maxWidth: "68ch" }}>
            <strong>Advisory only.</strong> {snapshot.message}
          </p>

          <p className="muted">
            Scope: release &ldquo;{snapshot.scope.release}&rdquo; on &ldquo;
            {snapshot.scope.environment}&rdquo; · {snapshot.approvedTestCaseCount} approved test case
            {snapshot.approvedTestCaseCount === 1 ? "" : "s"} · as of {snapshot.asOfUtc}
          </p>

          <h2>Finalized executions by result</h2>
          <p className="muted">{snapshot.executionFinalizedByResult.filters}</p>
          <div className="card card-flush" style={{ marginBottom: "var(--sp-5)" }}>
            {snapshot.executionFinalizedByResult.counts.length === 0 ? (
              <div className="empty">
                <p>No finalized executions in scope.</p>
              </div>
            ) : (
              snapshot.executionFinalizedByResult.counts.map((row) => (
                <div key={row.result ?? "none"} className="list-row">
                  {row.result ? <OutcomeChip outcome={row.result as ExecutionOutcome} /> : <span className="state">No result</span>}
                  <span style={{ fontWeight: 620 }}>{row._count}</span>
                  <span className="muted">of {snapshot.executionFinalizedByResult.denominatorCount} finalized in scope</span>
                </div>
              ))
            )}
          </div>

          <h2>Open defects by severity</h2>
          <p className="muted">{snapshot.openDefectsBySeverity.filters}</p>
          <div className="card card-flush" style={{ marginBottom: "var(--sp-5)" }}>
            {snapshot.openDefectsBySeverity.counts.length === 0 ? (
              <div className="empty">
                <p>No open defects in scope.</p>
              </div>
            ) : (
              snapshot.openDefectsBySeverity.counts.map((row) => (
                <div key={row.severity || "unset"} className="list-row">
                  <span style={{ fontWeight: 620, minWidth: 90 }}>{row.severity || "Not set"}</span>
                  <span style={{ fontWeight: 620 }}>{row._count}</span>
                  <span className="muted">of {snapshot.openDefectsBySeverity.denominatorCount} open in scope</span>
                </div>
              ))
            )}
          </div>

          <h2>Requirements without trace links</h2>
          <div className="card card-flush">
            {snapshot.requirementsWithoutTraceLinks.length === 0 ? (
              <div className="empty">
                <p>Every requirement in this product has at least one trace link.</p>
              </div>
            ) : (
              snapshot.requirementsWithoutTraceLinks.map((businessId) => (
                <div key={businessId} className="list-row">
                  <span className="bid">{businessId}</span>
                </div>
              ))
            )}
          </div>
        </>
      ) : null}
    </>
  );
}
