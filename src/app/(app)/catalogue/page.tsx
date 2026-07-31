import { QamsRole } from "@prisma/client";
import { notFound } from "next/navigation";
import { listFeatures, listModules, listProducts, listRequirements } from "@/domain/catalogue";
import { requireSession } from "@/ui/session";
import {
  AddFeatureModal,
  AddModuleModal,
  AddProductModal,
  AddRequirementModal
} from "./CatalogueForms";
import {
  EditableFeatureRow,
  EditableModuleRow,
  EditableProductRow,
  EditableRequirementRow
} from "./CatalogueEditForms";

export const dynamic = "force-dynamic";

/**
 * The Product → Module → Feature → Requirement hierarchy. Creation and editing are
 * QA-Lead-gated in the domain (an escalated policy choice — implementation audit
 * §6.1). Adding and editing happen in modals; business IDs and parent links are
 * immutable.
 */
export default async function CataloguePage() {
  const auth = await requireSession();
  // Lead-only screen: absent rather than present-and-rejecting for other roles
  // (the domain services behind it refuse them regardless).
  if (auth.role !== QamsRole.QA_LEAD) notFound();
  const [products, modules, features, requirements] = await Promise.all([
    listProducts(),
    listModules(),
    listFeatures(),
    listRequirements()
  ]);

  const productLabel = new Map(products.map((p) => [p.id, p.businessId]));
  const moduleLabel = new Map(modules.map((m) => [m.id, m.businessId]));
  const featureLabel = new Map(features.map((f) => [f.id, f.businessId]));

  const section = (title: string, addControl: React.ReactNode, rows: React.ReactNode) => (
    <>
      <div style={{ display: "flex", alignItems: "baseline", gap: "var(--sp-4)", flexWrap: "wrap" }}>
        <h2 style={{ flex: 1 }}>{title}</h2>
        {addControl}
      </div>
      <div className="card" style={{ padding: 0, marginBottom: "var(--sp-6)" }}>{rows}</div>
    </>
  );

  const empty = (
    <p className="muted" style={{ padding: "var(--sp-3) var(--sp-5)", margin: 0 }}>
      None yet.
    </p>
  );

  return (
    <>
      <h1>Catalogue</h1>
      <p className="muted" style={{ marginBottom: "var(--sp-5)" }}>
        {products.length} products · {modules.length} modules · {features.length} features ·{" "}
        {requirements.length} requirements
      </p>

      {section(
        "Products",
        <AddProductModal />,
        products.length === 0
          ? empty
          : products.map((p) => (
              <EditableProductRow
                key={p.id}
                id={p.id}
                version={p.version}
                businessId={p.businessId}
                name={p.name}
                versionTag={p.versionTag}
                status={p.status}
              >
                <span className="bid">{p.businessId}</span>
                <span style={{ flex: 1 }}>{p.name}</span>
                <span className="muted">v{p.versionTag}</span>
                <span className="muted">{p.status}</span>
              </EditableProductRow>
            ))
      )}

      {section(
        "Modules",
        <AddModuleModal products={products.map((p) => ({ id: p.id, businessId: p.businessId, label: p.name }))} />,
        modules.length === 0
          ? empty
          : modules.map((m) => (
              <EditableModuleRow key={m.id} id={m.id} version={m.version} businessId={m.businessId} name={m.name}>
                <span className="bid">{m.businessId}</span>
                <span style={{ flex: 1 }}>{m.name}</span>
                <span className="muted">{productLabel.get(m.productId)}</span>
              </EditableModuleRow>
            ))
      )}

      {section(
        "Features",
        <AddFeatureModal modules={modules.map((m) => ({ id: m.id, businessId: m.businessId, label: m.name }))} />,
        features.length === 0
          ? empty
          : features.map((f) => (
              <EditableFeatureRow key={f.id} id={f.id} version={f.version} businessId={f.businessId} name={f.name}>
                <span className="bid">{f.businessId}</span>
                <span style={{ flex: 1 }}>{f.name}</span>
                <span className="muted">{moduleLabel.get(f.moduleId)}</span>
              </EditableFeatureRow>
            ))
      )}

      {section(
        "Requirements",
        <AddRequirementModal features={features.map((f) => ({ id: f.id, businessId: f.businessId, label: f.name }))} />,
        requirements.length === 0
          ? empty
          : requirements.map((r) => (
              <EditableRequirementRow
                key={r.id}
                id={r.id}
                version={r.version}
                businessId={r.businessId}
                statement={r.statement}
              >
                <span className="bid">{r.businessId}</span>
                <span style={{ flex: 1 }}>{r.statement}</span>
                <span className="muted">{featureLabel.get(r.featureId)}</span>
              </EditableRequirementRow>
            ))
      )}
    </>
  );
}
