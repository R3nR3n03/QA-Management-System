import { QamsRole } from "@prisma/client";
import { notFound } from "next/navigation";
import Link from "next/link";
import { FoldVertical } from "lucide-react";
import {
  catalogueTotals,
  getFeatureDetail,
  getModuleDetail,
  getProductDetail,
  getRequirementDetail,
  listCatalogueTree,
  resolveOpenIds,
  searchCatalogue,
  type CatalogueDetail
} from "@/domain/catalogue";
import type { SearchResults as Results } from "@/domain/catalogue-search";
import { AppError } from "@/lib/errors";
import { RoleSets } from "@/lib/rbac";
import { readPage, readParam, type ListSearchParams } from "@/ui/list-params";
import { requireSession } from "@/ui/session";
import { CatalogueSearch } from "./CatalogueSearch";
import { CatalogueTree } from "./CatalogueTree";
import { ContextualCreate } from "./CatalogueForms";
import { DetailPanel } from "./DetailPanel";
import { ExplorerResizer } from "./ExplorerResizer";
import { SearchResults } from "./SearchResults";
import {
  CHILD_PAGE_PARAM,
  collapseAllHref,
  readOpenSet,
  readSelection,
  type Selection
} from "./selection";

export const dynamic = "force-dynamic";

/**
 * The selected record, or `null`.
 *
 * A 404 is swallowed on purpose. `?sel=m:MOD404` is a well-formed selection of a record
 * that does not exist — a stale bookmark, or a link to something since renamed — and the
 * right answer is the overview, not a crashed screen. `parseSelection` has already refused
 * anything that could never be a business ID, so this only catches "valid shape, no such
 * row". Any other failure is a real fault and still propagates.
 *
 * Every level's child list is paged now, so `childPage` reaches all three getters rather
 * than only the feature's requirements.
 */
async function loadDetail(
  selection: Selection | null,
  childPage: number
): Promise<CatalogueDetail | null> {
  if (!selection) return null;
  try {
    if (selection.kind === "product") {
      return await getProductDetail(selection.businessId, { page: childPage });
    }
    if (selection.kind === "module") {
      return await getModuleDetail(selection.businessId, { page: childPage });
    }
    if (selection.kind === "feature") {
      return await getFeatureDetail(selection.businessId, { page: childPage });
    }
    return await getRequirementDetail(selection.businessId);
  } catch (error) {
    if (error instanceof AppError && error.status === 404) return null;
    throw error;
  }
}

/**
 * The Product → Module → Feature → Requirement hierarchy, as a master-detail explorer.
 *
 * This screen was four stacked, independently paged tables — Products, Modules, Features
 * and Requirements — with no visible relationship between them. The tree on the left now
 * carries the structure and the panel on the right carries one record at a time, so the
 * relationship is the layout. Rationale and wireframes:
 * `CATALOGUE-EXPLORER-REDESIGN.md`.
 *
 * Creation and editing are QA-Lead-gated in the domain (an escalated policy choice —
 * implementation audit §6.1). Both happen in modals; business IDs and parent links are
 * immutable.
 *
 * Selection lives in the query string rather than component state, because every server
 * action here ends in `refreshScreen` and so returns to the URL it was submitted from —
 * add a feature to MOD004 and you are still on MOD004. See `selection.ts`.
 *
 * ## What this screen costs, and what it used to
 *
 * Every interaction here is a navigation, so the query count per interaction is the
 * budget. It was roughly twenty, and three of those read whole tables:
 *
 * - `listCatalogueOptions()` fetched EVERY product, module and feature on every load, to
 *   fill create-dialog dropdowns that are never rendered — the selection always supplies
 *   the parent, and the dialog states it instead of asking. Gone entirely.
 * - Searching read the whole Product, Module and Feature tables and filtered them in
 *   JavaScript. It is now four `LIMIT`-ed queries — and when a search is running the tree
 *   is not fetched at all, because the results replace it.
 * - The tree fetched an unbounded fourth level. There is no fourth level.
 *
 * The two modes are exclusive on purpose: browsing costs the tree, searching costs the
 * hits, and neither pays for the other.
 */
export default async function CataloguePage({
  searchParams
}: {
  searchParams: Promise<ListSearchParams>;
}) {
  const params = await searchParams;
  const auth = await requireSession();
  /* Authors and up (RATIFIED 2026-08-10, `docs/roles-workflows.md` catalogue rows). It was
     QA-Lead-only, matching `RoleSets.canAdmin`; requirements are now `canWriteRequirements`,
     so a QA Engineer has to be able to open the screen that creates one. A QA Tester authors
     nothing and is still absent rather than present-and-rejecting.

     `mayAdminCatalogue` is what keeps the screen honest for the roles in between: they get
     the tree, the detail panels and the requirement form, and the Product / Module / Feature
     create and edit affordances are not rendered. The domain refuses them regardless — this
     only decides whether a control they cannot use is on screen. */
  const mayAdminCatalogue = auth.role === QamsRole.QA_LEAD;
  const mayWriteRequirements = (RoleSets.canWriteRequirements as readonly QamsRole[]).includes(
    auth.role
  );
  if (!mayWriteRequirements) notFound();

  const selection = readSelection(params);
  const needle = readParam(params, "q");
  const childPage = readPage(params, CHILD_PAGE_PARAM);
  const searching = needle !== "";

  // Before the tree, not beside it: the tree opens branches by row id, and these two are
  // what resolve business IDs to them — the detail for the selected record's ancestors,
  // `resolveOpenIds` for the branches the viewer expanded. Independent of each other, so
  // they still run together. `resolveOpenIds` is skipped while searching, because the tree
  // it would open is not on screen.
  const [detail, opened] = await Promise.all([
    loadDetail(selection, childPage),
    searching
      ? Promise.resolve({ productIds: [], moduleIds: [] })
      : resolveOpenIds([...readOpenSet(params)])
  ]);

  /**
   * The selected record's ancestors are open whether or not `?open=` names them.
   *
   * `?open=` is what the viewer expanded by hand; this is the branch the selection is
   * sitting in. Without it a link or a bookmark to `?sel=f:FEAT012` would land on a
   * collapsed tree with the selected row nowhere on it. Selecting reveals; it no longer
   * COLLAPSES anything, which is the half of the old behaviour that was the bug.
   */
  const withAncestors = (ids: string[], ancestor: string | null | undefined) =>
    ancestor ? [...new Set([...ids, ancestor])] : ids;

  const [totals, tree, results] = await Promise.all([
    catalogueTotals(),
    // Exactly one of these two runs. The results replace the tree while a search is
    // running, so fetching both would be paying for a panel nobody is looking at.
    searching
      ? Promise.resolve(null)
      : listCatalogueTree({
          openProductIds: withAncestors(opened.productIds, detail?.path.productId),
          openModuleIds: withAncestors(opened.moduleIds, detail?.path.moduleId)
        }),
    searching ? searchCatalogue(needle) : Promise.resolve<Results | null>(null)
  ]);

  /**
   * What the header's one button will create, and inside what.
   *
   * For the first three levels the selected record IS the parent. A requirement has
   * nothing beneath it, so selecting one offers a sibling instead — another requirement
   * under the same feature, which is what someone writing requirements actually wants
   * next. The feature's id comes from `path`; its label from the breadcrumb trail.
   */
  const featureCrumb = detail?.trail.find((step) => step.kind === "feature");
  const createUnder =
    detail === null
      ? null
      : detail.kind === "requirement"
        ? featureCrumb && detail.path.featureId
          ? {
              kind: "feature" as const,
              parent: {
                id: detail.path.featureId,
                businessId: featureCrumb.businessId,
                label: featureCrumb.name
              }
            }
          : null
        : {
            kind: detail.kind,
            parent: { id: detail.id, businessId: detail.businessId, label: detail.title }
          };

  const openCount = readOpenSet(params).size;

  return (
    <div className="cat-screen">
      <div className="cat-head">
        <div className="page-head">
          <div className="page-head-text">
            <h1>Catalogue</h1>
            <p className="muted">Product → Module → Feature → Requirement</p>
          </div>
          {/* One call to action, and what it creates follows the selection. The role decides
              how many levels its caret offers — presentation only; every gate is the
              domain's (`RoleSets.canAdmin` for the three structural levels,
              `canWriteRequirements` for requirements). */}
          <ContextualCreate selection={createUnder} mayAdminCatalogue={mayAdminCatalogue} />
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
          <CatalogueSearch
            matchCount={results ? results.hits.length : null}
            truncated={results?.truncated ?? false}
            needle={needle}
          />

          {/* Twelve open branches take twelve clicks to undo, and each one is a round
              trip. Only offered when there is something to collapse, and never while
              searching — there is no tree to fold. */}
          {!searching && openCount > 0 ? (
            <div className="cat-tree-tools">
              <Link className="cat-collapse" href={collapseAllHref(params)}>
                <FoldVertical size={13} aria-hidden />
                Collapse all
                <span className="sr-only"> {openCount} open branches</span>
              </Link>
            </div>
          ) : null}

          {/* Exactly one of the two panels, decided by the same flag that decided which
              query ran. Nested rather than chained, so a future third state cannot fall
              through to "No products yet." while a search is on screen. */}
          {searching ? (
            results === null ? null : (
              <SearchResults
                results={results}
                needle={needle}
                selected={selection}
                params={params}
              />
            )
          ) : tree === null || tree.products.length === 0 ? (
            <p className="cat-tree-note">No products yet.</p>
          ) : (
            <CatalogueTree tree={tree} selected={selection} params={params} />
          )}
        </nav>

        {/* The explorer's width is a preference about this viewer's screen, so the handle
            writes a CSS variable and localStorage rather than the URL. */}
        <ExplorerResizer />

        {/*
          `tabIndex={-1}` so `TreeKeyboard` can move focus here when a row is activated
          with Enter or Space. Without it, choosing a record from the keyboard replaces
          the entire right-hand side of the screen and says nothing to anyone who is not
          watching it happen. Arrow keys deliberately do not focus this — they mean "look
          around", and focus belongs in the tree while you do.
        */}
        <section className="cat-detail" id="cat-detail" tabIndex={-1} aria-label="Selected record">
          <DetailPanel
            detail={detail}
            params={params}
            childPage={childPage}
            needle={needle}
            totals={totals}
            hasAnyProduct={totals.products > 0}
            mayAdminCatalogue={mayAdminCatalogue}
          />
        </section>
      </div>
    </div>
  );
}
