import { QamsRole } from "@prisma/client";
import { notFound } from "next/navigation";
import {
  catalogueTotals,
  getFeatureDetail,
  getModuleDetail,
  getProductDetail,
  listCatalogueOptions,
  listCatalogueTree,
  listFeatures,
  listModules,
  listProducts,
  listRequirements,
  type CatalogueDetail
} from "@/domain/catalogue";
import { AppError } from "@/lib/errors";
import { readPage, readParam, type ListSearchParams } from "@/ui/list-params";
import { Pager } from "@/ui/pager";
import { requireSession } from "@/ui/session";
import { CatalogueTree } from "./CatalogueTree";
import { readSelection, type Selection } from "./selection";
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
 * The selected record, or `null`.
 *
 * A 404 is swallowed on purpose. `?sel=m:MOD404` is a well-formed selection of a record
 * that does not exist — a stale bookmark, or a link to something since renamed — and the
 * right answer is the overview, not a crashed screen. `parseSelection` has already refused
 * anything that could never be a business ID, so this only catches "valid shape, no such
 * row". Any other failure is a real fault and still propagates.
 */
async function loadDetail(
  selection: Selection | null,
  requirementPage: number
): Promise<CatalogueDetail | null> {
  if (!selection) return null;
  try {
    if (selection.kind === "product") return await getProductDetail(selection.businessId);
    if (selection.kind === "module") return await getModuleDetail(selection.businessId);
    return await getFeatureDetail(selection.businessId, { page: requirementPage });
  } catch (error) {
    if (error instanceof AppError && error.status === 404) return null;
    throw error;
  }
}

/**
 * The Product → Module → Feature → Requirement hierarchy, as a master-detail explorer:
 * the tree on the left, the selected record and its children on the right. Creation and
 * editing are QA-Lead-gated in the domain (an escalated policy choice — implementation
 * audit §6.1); both happen in modals, and business IDs and parent links are immutable.
 *
 * Selection lives in the query string rather than component state, because every server
 * action here ends in `refreshScreen` and so returns to the URL it was submitted from —
 * see `selection.ts` for the full reasoning. Which branches of the tree are open follows
 * from the selection's ancestry, which is why the detail is resolved first: its `path`
 * carries the row ids the tree opens by.
 *
 * The four stacked lists below are on their way out (`CATALOGUE-EXPLORER-REDESIGN.md`
 * § 12, commit 3). They are inside the detail panel for now so the screen keeps working
 * while the frame and the tree are proven.
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

  const selection = readSelection(params);
  const needle = readParam(params, "q");
  // Sequential, not parallel: the tree opens branches by row id, and the detail is what
  // resolves a selected feature's module and product to ids.
  const detail = await loadDetail(selection, readPage(params, "req"));

  const [totals, tree, products, modules, features, requirements, options] = await Promise.all([
    catalogueTotals(),
    listCatalogueTree({
      q: needle,
      openProductId: detail?.path.productId,
      openModuleId: detail?.path.moduleId ?? undefined
    }),
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

  const stat = (label: string, value: number) => (
    <div className="cat-stat">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );

  return (
    <div className="cat-screen">
      <div className="cat-head">
        <div className="page-head">
          <div className="page-head-text">
            <h1>Catalogue</h1>
            <p className="muted">Product → Module → Feature → Requirement</p>
          </div>
        </div>
        <dl className="cat-stats">
          {stat("Products", totals.products)}
          {stat("Modules", totals.modules)}
          {stat("Features", totals.features)}
          {stat("Requirements", totals.requirements)}
        </dl>
      </div>

      <div className="cat">
        <nav className="cat-explorer" aria-label="Catalogue browser">
          {tree.products.length === 0 ? (
            <p className="cat-tree-note">
              {needle === "" ? "No products yet." : `Nothing matches “${needle}”.`}
            </p>
          ) : (
            <CatalogueTree tree={tree} selected={selection} params={params} />
          )}
        </nav>

        <div className="cat-detail">
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
        </div>
      </div>
    </div>
  );
}
