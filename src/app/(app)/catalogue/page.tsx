import { QamsRole } from "@prisma/client";
import { notFound } from "next/navigation";
import {
  catalogueTotals,
  getFeatureDetail,
  getModuleDetail,
  getProductDetail,
  listCatalogueOptions,
  listCatalogueTree,
  type CatalogueDetail
} from "@/domain/catalogue";
import { AppError } from "@/lib/errors";
import { readPage, readParam, type ListSearchParams } from "@/ui/list-params";
import { requireSession } from "@/ui/session";
import { CatalogueSearch } from "./CatalogueSearch";
import { CatalogueTree } from "./CatalogueTree";
import { ContextualCreate } from "./CatalogueForms";
import { DetailPanel } from "./DetailPanel";
import { readSelection, type Selection } from "./selection";

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
 * The Product → Module → Feature → Requirement hierarchy, as a master-detail explorer.
 *
 * This screen was four stacked, independently paged tables — Products, Modules, Features
 * and Requirements — with no visible relationship between them. The Requirements table was
 * the worst of it: a statement beside a feature ID, and no way to tell which module or
 * product that feature belonged to. The tree on the left now carries the structure and the
 * panel on the right carries one record at a time, so the relationship is the layout.
 * Rationale, wireframes and the full architecture: `CATALOGUE-EXPLORER-REDESIGN.md`.
 *
 * Creation and editing are QA-Lead-gated in the domain (an escalated policy choice —
 * implementation audit §6.1). Both happen in modals; business IDs and parent links are
 * immutable.
 *
 * Selection lives in the query string rather than component state, because every server
 * action here ends in `refreshScreen` and so returns to the URL it was submitted from —
 * add a feature to MOD004 and you are still on MOD004. See `selection.ts`.
 *
 * Requirements are rows in a feature's panel rather than tree nodes: they are the
 * highest-cardinality level and their label is a sentence, which is neither readable in a
 * 300px tree row nor scannable fifty at a time. Theirs is the one child list still paged,
 * so it keeps its own page key (`?req=2`) and `hrefWith` carries the selection alongside.
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

  const selection = readSelection(params);
  const needle = readParam(params, "q");
  const requirementPage = readPage(params, "req");

  // Sequential, not parallel: the tree opens branches by row id, and the detail is what
  // resolves a selected feature's module and product to ids.
  const detail = await loadDetail(selection, requirementPage);

  const [totals, tree, options] = await Promise.all([
    catalogueTotals(),
    listCatalogueTree({
      q: needle,
      openProductId: detail?.path.productId,
      openModuleId: detail?.path.moduleId ?? undefined
    }),
    // The create dialogs still need every possible parent for the case where nothing is
    // selected and no parent is implied — three columns each, not whole records.
    listCatalogueOptions()
  ]);

  const asParent = (row: { id: string; businessId: string; name: string }) => ({
    id: row.id,
    businessId: row.businessId,
    label: row.name
  });

  return (
    <div className="cat-screen">
      <div className="cat-head">
        <div className="page-head">
          <div className="page-head-text">
            <h1>Catalogue</h1>
            <p className="muted">Product → Module → Feature → Requirement</p>
          </div>
          {/* One call to action, and what it creates follows the selection. */}
          <ContextualCreate
            selection={
              detail === null
                ? null
                : {
                    kind: detail.kind,
                    parent: { id: detail.id, businessId: detail.businessId, label: detail.title }
                  }
            }
            options={{
              products: options.products.map(asParent),
              modules: options.modules.map(asParent),
              features: options.features.map(asParent)
            }}
          />
        </div>
        <dl className="cat-stats">
          <div className="cat-stat">
            <dt>Products</dt>
            <dd>{totals.products}</dd>
          </div>
          <div className="cat-stat">
            <dt>Modules</dt>
            <dd>{totals.modules}</dd>
          </div>
          <div className="cat-stat">
            <dt>Features</dt>
            <dd>{totals.features}</dd>
          </div>
          <div className="cat-stat">
            <dt>Requirements</dt>
            <dd>{totals.requirements}</dd>
          </div>
        </dl>
      </div>

      <div className="cat">
        <nav className="cat-explorer" aria-label="Catalogue browser">
          <CatalogueSearch matchCount={tree.matchCount} needle={needle} />
          {/* A search that matched nothing says so in the live region above rather than
              here, so the message is announced as well as shown — and an empty
              `role="tree"` with no items is never rendered. */}
          {tree.products.length === 0 ? (
            needle === "" ? <p className="cat-tree-note">No products yet.</p> : null
          ) : (
            <CatalogueTree tree={tree} selected={selection} params={params} />
          )}
        </nav>

        <div className="cat-detail">
          <DetailPanel
            detail={detail}
            params={params}
            requirementPage={requirementPage}
            needle={needle}
            totals={totals}
            hasAnyProduct={totals.products > 0}
          />
        </div>
      </div>
    </div>
  );
}
