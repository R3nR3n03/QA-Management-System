import { QamsRole } from "@prisma/client";
import { notFound } from "next/navigation";
import { listFeatures, listModules, listProducts, listRequirements } from "@/domain/catalogue";
import { requireSession } from "@/ui/session";
import { FeatureForm, ModuleForm, ProductForm, RequirementForm } from "./CatalogueForms";

export const dynamic = "force-dynamic";

/**
 * The Product → Module → Feature → Requirement hierarchy. Creation is QA-Lead-gated
 * in the domain (an escalated policy choice — implementation audit §6.1); edits go
 * through the API's PATCH endpoints for now.
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

  const section = (title: string, rows: React.ReactNode, form: React.ReactNode) => (
    <>
      <h2>{title}</h2>
      <div className="card" style={{ padding: 0, marginBottom: "var(--sp-3)" }}>{rows}</div>
      <div className="card" style={{ marginBottom: "var(--sp-6)" }}>{form}</div>
    </>
  );

  const rowStyle = {
    display: "flex",
    gap: "var(--sp-4)",
    padding: "var(--sp-2) var(--sp-5)",
    borderBottom: "1px solid var(--line-soft)"
  } as const;

  return (
    <>
      <h1>Catalogue</h1>
      <p className="muted" style={{ marginBottom: "var(--sp-5)" }}>
        {products.length} products · {modules.length} modules · {features.length} features ·{" "}
        {requirements.length} requirements
      </p>

      {section(
        "Products",
        products.length === 0 ? (
          <p className="muted" style={{ padding: "var(--sp-3) var(--sp-5)", margin: 0 }}>None yet.</p>
        ) : (
          products.map((p) => (
            <div key={p.id} style={rowStyle}>
              <span className="bid">{p.businessId}</span>
              <span style={{ flex: 1 }}>{p.name}</span>
              <span className="muted">v{p.versionTag}</span>
              <span className="muted">{p.status}</span>
            </div>
          ))
        ),
        <ProductForm />
      )}

      {section(
        "Modules",
        modules.length === 0 ? (
          <p className="muted" style={{ padding: "var(--sp-3) var(--sp-5)", margin: 0 }}>None yet.</p>
        ) : (
          modules.map((m) => (
            <div key={m.id} style={rowStyle}>
              <span className="bid">{m.businessId}</span>
              <span style={{ flex: 1 }}>{m.name}</span>
              <span className="muted">{productLabel.get(m.productId)}</span>
            </div>
          ))
        ),
        <ModuleForm products={products.map((p) => ({ id: p.id, businessId: p.businessId, label: p.name }))} />
      )}

      {section(
        "Features",
        features.length === 0 ? (
          <p className="muted" style={{ padding: "var(--sp-3) var(--sp-5)", margin: 0 }}>None yet.</p>
        ) : (
          features.map((f) => (
            <div key={f.id} style={rowStyle}>
              <span className="bid">{f.businessId}</span>
              <span style={{ flex: 1 }}>{f.name}</span>
              <span className="muted">{moduleLabel.get(f.moduleId)}</span>
            </div>
          ))
        ),
        <FeatureForm modules={modules.map((m) => ({ id: m.id, businessId: m.businessId, label: m.name }))} />
      )}

      {section(
        "Requirements",
        requirements.length === 0 ? (
          <p className="muted" style={{ padding: "var(--sp-3) var(--sp-5)", margin: 0 }}>None yet.</p>
        ) : (
          requirements.map((r) => (
            <div key={r.id} style={rowStyle}>
              <span className="bid">{r.businessId}</span>
              <span style={{ flex: 1 }}>{r.statement}</span>
              <span className="muted">{featureLabel.get(r.featureId)}</span>
            </div>
          ))
        ),
        <RequirementForm features={features.map((f) => ({ id: f.id, businessId: f.businessId, label: f.name }))} />
      )}
    </>
  );
}
