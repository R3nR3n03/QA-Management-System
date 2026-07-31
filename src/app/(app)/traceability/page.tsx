import { QamsRole } from "@prisma/client";
import { listDefects } from "@/domain/defects";
import { listRequirements } from "@/domain/catalogue";
import { listTestCases } from "@/domain/test-cases";
import { listRtmLinks } from "@/domain/traceability";
import { requireSession } from "@/ui/session";
import { LinkForm } from "./LinkForm";

export const dynamic = "force-dynamic";

/**
 * The requirements traceability matrix: every recorded requirement ↔ test case
 * (↔ defect) link, and the requirements that still have none — the gap list is the
 * point of an RTM.
 */
export default async function TraceabilityPage() {
  const auth = await requireSession();
  const [links, requirements, cases, defects] = await Promise.all([
    listRtmLinks(),
    listRequirements(),
    listTestCases(),
    listDefects()
  ]);

  const requirementById = new Map(requirements.map((r) => [r.id, r]));
  const caseById = new Map(cases.map((c) => [c.id, c]));
  const defectById = new Map(defects.map((d) => [d.id, d]));
  const linkedRequirementIds = new Set(links.map((l) => l.requirementId));
  const unlinked = requirements.filter((r) => !linkedRequirementIds.has(r.id));
  const mayLink = auth.role !== QamsRole.QA_TESTER;

  return (
    <>
      <h1>Traceability</h1>
      <p className="muted" style={{ marginBottom: "var(--sp-4)" }}>
        {links.length} trace link{links.length === 1 ? "" : "s"} · {unlinked.length} requirement
        {unlinked.length === 1 ? "" : "s"} without any link.
      </p>

      {unlinked.length > 0 ? (
        <>
          <h2>Requirements without trace links</h2>
          <div className="card" style={{ padding: 0, marginBottom: "var(--sp-5)" }}>
            {unlinked.map((requirement) => (
              <div
                key={requirement.id}
                style={{ display: "flex", gap: "var(--sp-4)", padding: "var(--sp-3) var(--sp-5)", borderBottom: "1px solid var(--line-soft)" }}
              >
                <span className="bid">{requirement.businessId}</span>
                <span style={{ color: "var(--ink-2)" }}>{requirement.statement}</span>
              </div>
            ))}
          </div>
        </>
      ) : null}

      <h2>Trace links</h2>
      <div className="card" style={{ padding: 0, marginBottom: "var(--sp-5)" }}>
        {links.length === 0 ? (
          <p className="muted" style={{ padding: "var(--sp-4) var(--sp-5)", margin: 0 }}>
            No trace links yet.
          </p>
        ) : (
          links.map((link) => {
            const requirement = requirementById.get(link.requirementId);
            const testCase = caseById.get(link.testCaseId);
            const defect = link.defectId ? defectById.get(link.defectId) : null;
            return (
              <div
                key={link.id}
                style={{ display: "flex", gap: "var(--sp-4)", padding: "var(--sp-3) var(--sp-5)", borderBottom: "1px solid var(--line-soft)", flexWrap: "wrap" }}
              >
                <span className="bid">{requirement?.businessId ?? "?"}</span>
                <span className="muted">→</span>
                <span className="bid">{testCase?.businessId ?? "?"}</span>
                {defect ? (
                  <>
                    <span className="muted">→</span>
                    <span className="bid">{defect.businessId}</span>
                  </>
                ) : null}
                <span style={{ color: "var(--ink-2)", flex: 1, minWidth: 200 }}>{testCase?.title}</span>
              </div>
            );
          })
        )}
      </div>

      {mayLink ? (
        <>
          <h2>New trace link</h2>
          <div className="card">
            <LinkForm
              requirements={requirements.map((r) => ({ id: r.id, businessId: r.businessId, label: r.statement }))}
              cases={cases.map((c) => ({ id: c.id, businessId: c.businessId, title: c.title, requirementId: c.requirementId }))}
              defects={defects.map((d) => ({ id: d.id, businessId: d.businessId, summary: d.summary, testCaseId: d.testCaseId }))}
            />
          </div>
        </>
      ) : null}
    </>
  );
}
