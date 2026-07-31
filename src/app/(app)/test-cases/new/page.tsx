import { listControlledValues } from "@/domain/admin";
import { listFeatures, listModules, listProducts, listRequirements } from "@/domain/catalogue";
import { CATALOGUE_PRIORITY, CATALOGUE_SEVERITY } from "@/lib/controlled-value-catalogues";
import { requireSession } from "@/ui/session";
import { NewCaseForm } from "./NewCaseForm";

export const dynamic = "force-dynamic";

/**
 * Drafting starts from the hierarchy: a test case must chain Product → Module →
 * Feature → Requirement (`docs/data-model.md`), so the form is built around picking
 * that chain. `?revises=<id>` threads a revision link through — the only way to
 * change Approved content (`roles-workflows.md:30`).
 */
export default async function NewTestCasePage({
  searchParams
}: {
  searchParams: Promise<{ revises?: string }>;
}) {
  await requireSession();
  const { revises } = await searchParams;

  const [products, modules, features, requirements, controlled] = await Promise.all([
    listProducts(),
    listModules(),
    listFeatures(),
    listRequirements(),
    listControlledValues()
  ]);

  const active = (catalogue: string) =>
    controlled.filter((v) => v.catalogue === catalogue && v.active).map((v) => v.value);

  return (
    <>
      <h1>New test case</h1>
      <p className="muted" style={{ marginBottom: "var(--sp-4)" }}>
        {revises
          ? "This draft revises an approved case; the link is recorded on creation."
          : "Created in Draft, visible to every role, editable until submitted for review."}
      </p>
      <div className="card">
        <NewCaseForm
          products={products.map((p) => ({ id: p.id, businessId: p.businessId, label: p.name }))}
          modules={modules.map((m) => ({ id: m.id, businessId: m.businessId, label: m.name, parentId: m.productId }))}
          features={features.map((f) => ({ id: f.id, businessId: f.businessId, label: f.name, parentId: f.moduleId }))}
          requirements={requirements.map((r) => ({ id: r.id, businessId: r.businessId, label: r.statement, parentId: r.featureId }))}
          priorities={active(CATALOGUE_PRIORITY)}
          severities={active(CATALOGUE_SEVERITY)}
          revisesTestCaseId={revises}
        />
      </div>
    </>
  );
}
