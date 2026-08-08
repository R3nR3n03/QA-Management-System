/**
 * Assembling the catalogue explorer's tree from flat rows.
 *
 * Pure — no Prisma import — so the parts that are easy to get subtly wrong are testable
 * without a database: which branches count as loaded, what a count means, and how many
 * children one branch is allowed to draw. `src/domain/catalogue.ts` runs the queries and
 * hands the rows here. Same split as `import-parsing.ts` beside it, and for the same
 * reason: `npm run test` must stay runnable with no PostgreSQL
 * (`vitest.acceptance.config.ts:6-8`).
 *
 * ## The tree stops at Feature
 *
 * Product → Module → Feature. Requirements are NOT tree nodes: they are the
 * highest-cardinality level by a wide margin, their label is a whole sentence rather than
 * a name, and a 300px column truncates a sentence into nothing legible. They live in the
 * feature's detail panel, which pages them, and in search results, which rank and bound
 * them. See `docs/adr/0001-catalogue-tree-stops-at-feature.md`.
 *
 * ## Search is not here
 *
 * Filtering the tree to a needle used to live in this file (`narrowToMatches`). It read
 * the whole Product, Module and Feature tables on every keystroke and filtered them in
 * JavaScript, then force-expanded every surviving branch. Search is now a flat, ranked,
 * database-bounded result list — `./catalogue-search`. See
 * `docs/adr/0002-catalogue-search-is-a-flat-ranked-list.md`.
 */

export type NodeRow = { id: string; businessId: string; name: string };
export type ModuleRow = NodeRow & { productId: string };
export type FeatureRow = NodeRow & { moduleId: string };

/**
 * How many children one open branch draws before the rest are deferred.
 *
 * A branch is not a list screen. Past a screenful or two the rows stop being scannable and
 * start being scroll, and the detail panel — which pages every child list — is the place
 * that reads a long list properly. The cap is what stops one 400-feature module from
 * deciding how big the whole tree is.
 */
export const DEFAULT_CHILD_LIMIT = 50;

/** The leaf of the tree. Its requirements are read in the detail panel, not here. */
export type TreeFeature = NodeRow & { requirementCount: number };

export type TreeModule = NodeRow & {
  featureCount: number;
  /**
   * `null` and `[]` are different answers and the explorer draws them differently.
   *
   * `null` = this branch was never fetched, because it is closed. The row gets a chevron
   * and nothing else. `[]` = it WAS fetched and the module genuinely has no features,
   * which is the empty state that tells a QA Lead the catalogue is incomplete. Collapsing
   * the two would either hide a real gap or promise children that were never loaded.
   */
  features: TreeFeature[] | null;
  /** Children the cap held back. `0` when everything is on screen. */
  hiddenFeatures: number;
};

export type TreeProduct = NodeRow & {
  moduleCount: number;
  modules: TreeModule[] | null;
  hiddenModules: number;
};

export type CatalogueTree = {
  products: TreeProduct[];
  /** Products the cap held back, same rule as any other level. */
  hiddenProducts: number;
};

/** `rows` grouped by a foreign key, input order preserved within each group. */
function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const bucket = out.get(key(row));
    if (bucket) bucket.push(row);
    else out.set(key(row), [row]);
  }
  return out;
}

/**
 * The first `limit` rows, and how many the caller is not being shown.
 *
 * `hidden` is measured against `total` — the database's count for the branch — rather than
 * against `rows.length`, because `total` is what the viewer needs in order to decide
 * whether opening the record is worth it. "+ 312 more" is a fact about the catalogue;
 * "+ 0 more" would be a fact about the fetch.
 */
function capped<T>(rows: readonly T[], limit: number, total: number): { shown: T[]; hidden: number } {
  if (rows.length <= limit) return { shown: [...rows], hidden: 0 };
  const shown = rows.slice(0, limit);
  return { shown, hidden: Math.max(0, total - shown.length) };
}

export type AssembleInput = {
  products: readonly NodeRow[];
  /** Modules of the open products only. */
  modules: readonly ModuleRow[];
  /** Features of the open modules only. */
  features: readonly FeatureRow[];
  moduleCounts: ReadonlyMap<string, number>;
  featureCounts: ReadonlyMap<string, number>;
  requirementCounts: ReadonlyMap<string, number>;
  openProductIds: ReadonlySet<string>;
  openModuleIds: ReadonlySet<string>;
  /** Defaults to `DEFAULT_CHILD_LIMIT`. */
  childLimit?: number;
  /** Products in the catalogue, when more were counted than fetched. */
  productTotal?: number;
};

/**
 * The flat rows as a tree.
 *
 * A branch is rendered as loaded only when its parent id is in the open set, so a closed
 * product reports `modules: null` even if rows for it happened to arrive. That keeps one
 * rule — "open decides what is shown" — instead of letting the query's reach decide it.
 */
export function assembleTree(input: AssembleInput): CatalogueTree {
  const limit = input.childLimit ?? DEFAULT_CHILD_LIMIT;
  const modulesByProduct = groupBy(input.modules, (m) => m.productId);
  const featuresByModule = groupBy(input.features, (f) => f.moduleId);

  const rootTotal = input.productTotal ?? input.products.length;
  const root = capped(input.products, limit, rootTotal);

  const products = root.shown.map((product) => {
    const moduleCount = input.moduleCounts.get(product.id) ?? 0;
    if (!input.openProductIds.has(product.id)) {
      return {
        id: product.id,
        businessId: product.businessId,
        name: product.name,
        moduleCount,
        modules: null,
        hiddenModules: 0
      };
    }

    const branch = capped(modulesByProduct.get(product.id) ?? [], limit, moduleCount);

    return {
      id: product.id,
      businessId: product.businessId,
      name: product.name,
      moduleCount,
      modules: branch.shown.map((moduleRow) => {
        const featureCount = input.featureCounts.get(moduleRow.id) ?? 0;
        if (!input.openModuleIds.has(moduleRow.id)) {
          return {
            id: moduleRow.id,
            businessId: moduleRow.businessId,
            name: moduleRow.name,
            featureCount,
            features: null,
            hiddenFeatures: 0
          };
        }

        const leaves = capped(featuresByModule.get(moduleRow.id) ?? [], limit, featureCount);

        return {
          id: moduleRow.id,
          businessId: moduleRow.businessId,
          name: moduleRow.name,
          featureCount,
          features: leaves.shown.map((feature) => ({
            id: feature.id,
            businessId: feature.businessId,
            name: feature.name,
            requirementCount: input.requirementCounts.get(feature.id) ?? 0
          })),
          hiddenFeatures: leaves.hidden
        };
      }),
      hiddenModules: branch.hidden
    };
  });

  return { products, hiddenProducts: root.hidden };
}
