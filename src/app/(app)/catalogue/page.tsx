import { QamsRole } from "@prisma/client";
import { notFound } from "next/navigation";
import {
  listCatalogueOptions,
  listFeatures,
  listModules,
  listProducts,
  listRequirements
} from "@/domain/catalogue";
import { readPage, type ListSearchParams } from "@/ui/list-params";
import { Pager } from "@/ui/pager";
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
 *
 * Four independent lists on one screen, so each owns its own page key
 * (`?products=2&modules=3`) and `hrefWith` carries the other three along untouched —
 * paging one section must not reset the rest.
 */
export default async function CataloguePage({
  searchParams
}: {
  searchParams: Promise<ListSearchParams>;
}) {
  const params = await searchParams;
  const auth = await requireSession();
  // Lead-only screen: absent rather than present-and-rejecting for other roles
  // (the domain services behind it refuse them regardless).
  if (auth.role !== QamsRole.QA_LEAD) notFound();

  const pages = {
    products: readPage(params, "products"),
    modules: readPage(params, "modules"),
    features: readPage(params, "features"),
    requirements: readPage(params, "requirements")
  };

  const [products, modules, features, requirements, options] = await Promise.all([
    listProducts({ page: pages.products }),
    listModules({ page: pages.modules }),
    listFeatures({ page: pages.features }),
    listRequirements({ page: pages.requirements }),
    // Parent labels and "Add" dropdowns need every parent whatever page we are on —
    // three columns each, not whole records. See `listCatalogueOptions`.
    listCatalogueOptions()
  ]);

  const productLabel = new Map(options.products.map((p) => [p.id, p.businessId]));
  const moduleLabel = new Map(options.modules.map((m) => [m.id, m.businessId]));
  const featureLabel = new Map(options.features.map((f) => [f.id, f.businessId]));

  const section = (title: string, addControl: React.ReactNode, rows: React.ReactNode) => (
    <>
      <div className="page-head">
        <h2>{title}</h2>
        {addControl}
      </div>
      <div className="card card-flush" style={{ marginBottom: "var(--sp-6)" }}>{rows}</div>
    </>
  );

  const empty = <div className="empty"><p>None yet.</p></div>;

  return (
    <>
      <h1>Catalogue</h1>
      <p className="muted" style={{ marginBottom: "var(--sp-5)" }}>
        {products.total} products · {modules.total} modules · {features.total} features ·{" "}
        {requirements.total} requirements
      </p>

      {/* Rows stay server-rendered (they carry server-action edit forms) and are now the
          page the database returned, not the whole table sliced in the browser. */}
      {section(
        "Products",
        <AddProductModal />,
        products.rows.length === 0 ? (
          empty
        ) : (
          <>
            {products.rows.map((p) => (
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
            ))}
            <Pager
              total={products.total}
              page={pages.products}
              pathname="/catalogue"
              params={params}
              pageKey="products"
              label="products"
            />
          </>
        )
      )}

      {section(
        "Modules",
        <AddModuleModal
          products={options.products.map((p) => ({ id: p.id, businessId: p.businessId, label: p.name }))}
        />,
        modules.rows.length === 0 ? (
          empty
        ) : (
          <>
            {modules.rows.map((m) => (
              <EditableModuleRow key={m.id} id={m.id} version={m.version} businessId={m.businessId} name={m.name}>
                <span className="bid">{m.businessId}</span>
                <span style={{ flex: 1 }}>{m.name}</span>
                <span className="muted">{productLabel.get(m.productId)}</span>
              </EditableModuleRow>
            ))}
            <Pager
              total={modules.total}
              page={pages.modules}
              pathname="/catalogue"
              params={params}
              pageKey="modules"
              label="modules"
            />
          </>
        )
      )}

      {section(
        "Features",
        <AddFeatureModal
          modules={options.modules.map((m) => ({ id: m.id, businessId: m.businessId, label: m.name }))}
        />,
        features.rows.length === 0 ? (
          empty
        ) : (
          <>
            {features.rows.map((f) => (
              <EditableFeatureRow key={f.id} id={f.id} version={f.version} businessId={f.businessId} name={f.name}>
                <span className="bid">{f.businessId}</span>
                <span style={{ flex: 1 }}>{f.name}</span>
                <span className="muted">{moduleLabel.get(f.moduleId)}</span>
              </EditableFeatureRow>
            ))}
            <Pager
              total={features.total}
              page={pages.features}
              pathname="/catalogue"
              params={params}
              pageKey="features"
              label="features"
            />
          </>
        )
      )}

      {section(
        "Requirements",
        <AddRequirementModal
          features={options.features.map((f) => ({ id: f.id, businessId: f.businessId, label: f.name }))}
        />,
        requirements.rows.length === 0 ? (
          empty
        ) : (
          <>
            {requirements.rows.map((r) => (
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
            ))}
            <Pager
              total={requirements.total}
              page={pages.requirements}
              pathname="/catalogue"
              params={params}
              pageKey="requirements"
              label="requirements"
            />
          </>
        )
      )}
    </>
  );
}
