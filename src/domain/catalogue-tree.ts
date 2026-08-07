/**
 * Assembling the catalogue explorer's tree from flat rows.
 *
 * Pure — no Prisma import — so the parts that are easy to get subtly wrong are testable
 * without a database: which branches count as loaded, what a count means, and how a
 * search match drags its ancestors into view. `src/domain/catalogue.ts` runs the queries
 * and hands the rows here. Same split as `import-parsing.ts` beside it, and for the same
 * reason: `npm run test` must stay runnable with no PostgreSQL
 * (`vitest.acceptance.config.ts:6-8`).
 */

export type NodeRow = { id: string; businessId: string; name: string };
export type ModuleRow = NodeRow & { productId: string };
export type FeatureRow = NodeRow & { moduleId: string };
/** A requirement's `name` is its statement — mapped at the query, so every level of the
 *  tree has one shape and `nodeMatches` needs no special case. */
export type RequirementRow = NodeRow & { featureId: string };

/** The leaf. Nothing hangs off a requirement, so it carries no count. */
export type TreeRequirement = NodeRow;

export type TreeFeature = NodeRow & {
  requirementCount: number;
  requirements: TreeRequirement[] | null;
};

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
};

export type TreeProduct = NodeRow & {
  moduleCount: number;
  modules: TreeModule[] | null;
};

export type CatalogueTree = {
  products: TreeProduct[];
  /**
   * How many nodes the needle put on screen in their own right, for the line the explorer
   * announces to screen readers. `null` when nothing was searched — not the same as `0`.
   *
   * Counts NODES, not hits. A feature surfaced by three matching requirements counts once,
   * because one row appears; a product counts once however many descendants it drags in.
   * The number has to describe what the viewer can see, or the announcement and the tree
   * disagree.
   */
  matchCount: number | null;
};

/** Case-insensitive substring over the two things a person searches a node by. */
export function nodeMatches(row: NodeRow, needle: string): boolean {
  const q = needle.trim().toLowerCase();
  if (q === "") return true;
  return row.businessId.toLowerCase().includes(q) || row.name.toLowerCase().includes(q);
}

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

/** How many rows sit under each parent. The count badge in browse mode comes from the
 *  database; this is the search-mode equivalent, counting only what survived the filter. */
export function countByParent<T>(rows: readonly T[], key: (row: T) => string): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) out.set(key(row), (out.get(key(row)) ?? 0) + 1);
  return out;
}

export type AssembleInput = {
  products: readonly NodeRow[];
  /** Modules of the open products only, in browse mode. */
  modules: readonly ModuleRow[];
  /** Features of the open modules only, in browse mode. */
  features: readonly FeatureRow[];
  /** Requirements of the open features only, in browse mode. */
  requirements: readonly RequirementRow[];
  moduleCounts: ReadonlyMap<string, number>;
  featureCounts: ReadonlyMap<string, number>;
  requirementCounts: ReadonlyMap<string, number>;
  openProductIds: ReadonlySet<string>;
  openModuleIds: ReadonlySet<string>;
  openFeatureIds: ReadonlySet<string>;
  matchCount?: number | null;
};

/**
 * The flat rows as a tree.
 *
 * A branch is rendered as loaded only when its parent id is in the open set, so a closed
 * product reports `modules: null` even if rows for it happened to arrive. That keeps one
 * rule — "open decides what is shown" — instead of letting the query's reach decide it,
 * which is what makes browse mode and search mode share this function.
 */
export function assembleTree(input: AssembleInput): CatalogueTree {
  const modulesByProduct = groupBy(input.modules, (m) => m.productId);
  const featuresByModule = groupBy(input.features, (f) => f.moduleId);
  const requirementsByFeature = groupBy(input.requirements, (r) => r.featureId);

  const products = input.products.map((product) => ({
    id: product.id,
    businessId: product.businessId,
    name: product.name,
    moduleCount: input.moduleCounts.get(product.id) ?? 0,
    modules: input.openProductIds.has(product.id)
      ? (modulesByProduct.get(product.id) ?? []).map((moduleRow) => ({
          id: moduleRow.id,
          businessId: moduleRow.businessId,
          name: moduleRow.name,
          featureCount: input.featureCounts.get(moduleRow.id) ?? 0,
          features: input.openModuleIds.has(moduleRow.id)
            ? (featuresByModule.get(moduleRow.id) ?? []).map((feature) => ({
                id: feature.id,
                businessId: feature.businessId,
                name: feature.name,
                requirementCount: input.requirementCounts.get(feature.id) ?? 0,
                requirements: input.openFeatureIds.has(feature.id)
                  ? (requirementsByFeature.get(feature.id) ?? []).map((requirement) => ({
                      id: requirement.id,
                      businessId: requirement.businessId,
                      name: requirement.name
                    }))
                  : null
              }))
            : null
        }))
      : null
  }));

  return { products, matchCount: input.matchCount ?? null };
}

export type NarrowInput = {
  /** Every product, module and feature. Search fetches the whole spine — see below. */
  products: readonly NodeRow[];
  modules: readonly ModuleRow[];
  features: readonly FeatureRow[];
  needle: string;
  /**
   * The requirements that MATCHED, already selected by the database.
   *
   * Unlike the three levels above, these are not the whole table. Requirements outnumber
   * everything else several times over, so search fetches only the hits — and only the
   * hits are shown. A feature that matched by its own name appears closed, with its count,
   * rather than unfolding every requirement it owns; see the expansion rule below.
   */
  matchedRequirements?: readonly RequirementRow[];
};

export type NarrowResult = {
  products: NodeRow[];
  modules: ModuleRow[];
  features: FeatureRow[];
  requirements: RequirementRow[];
  openProductIds: Set<string>;
  openModuleIds: Set<string>;
  openFeatureIds: Set<string>;
  matchCount: number;
};

/**
 * The tree, filtered to a needle.
 *
 * The rule that makes search useful rather than confusing: **a match pulls its ancestors
 * in with it**. Matching `3-D Secure` shows FEAT012 under Checkout under Retail Banking,
 * not a naked feature row with no idea where it lives — which is exactly the orphaned
 * reading the whole redesign exists to remove. Matching a product, conversely, keeps all
 * of its modules, because "show me PROD002" means the product and its contents.
 *
 * Everything reachable is expanded: a search result behind a closed chevron is a search
 * result nobody finds.
 *
 * **The requirement level is the one exception, in both directions.** A matched product
 * keeps every module and a matched module every feature, but a matched FEATURE does not
 * unfold its requirements — it shows closed, with its count. Requirements outnumber the
 * other three levels several times over, and searching a common word would otherwise
 * empty most of the table into a 300px column. So: requirements appear when they
 * themselves matched, and a feature expands only because something inside it did.
 *
 * Search fetches every product, module and feature rather than resolving ancestors with
 * recursive queries. That is three light queries of three columns each — precisely what
 * `listCatalogueOptions` already does on every load of the current screen, so this is no
 * new cost, and it keeps the matching rules here where they can be tested. Requirements
 * are the exception again: only the matching rows are fetched.
 */
export function narrowToMatches(input: NarrowInput): NarrowResult {
  const matchedRequirements = input.matchedRequirements ?? [];

  const matchedProducts = new Set(
    input.products.filter((p) => nodeMatches(p, input.needle)).map((p) => p.id)
  );
  const matchedModules = new Set(
    input.modules.filter((m) => nodeMatches(m, input.needle)).map((m) => m.id)
  );
  const matchedFeatures = new Set(
    input.features.filter((f) => nodeMatches(f, input.needle)).map((f) => f.id)
  );

  // Nodes that earned their place directly, before ancestors and descendants are added.
  // A matched product does not make its 40 features "matches". A requirement is its own
  // row now, so it counts as itself rather than as the feature it hangs under.
  const matchCount =
    matchedProducts.size + matchedModules.size + matchedFeatures.size + matchedRequirements.length;

  // Downward: a matched product keeps every module, and a matched module every feature.
  // Deliberately stops there — a matched feature does not keep its requirements.
  const keptModules = input.modules.filter(
    (m) => matchedModules.has(m.id) || matchedProducts.has(m.productId)
  );
  const keptModuleIds = new Set(keptModules.map((m) => m.id));

  // Upward: a matched requirement drags its feature in, a kept feature its module, and a
  // kept module its product.
  const featuresFromRequirements = new Set(matchedRequirements.map((r) => r.featureId));

  const keptFeatures = input.features.filter(
    (f) =>
      matchedFeatures.has(f.id) ||
      keptModuleIds.has(f.moduleId) ||
      featuresFromRequirements.has(f.id)
  );

  const moduleById = new Map(input.modules.map((m) => [m.id, m]));
  const ancestorModules = new Set<string>();
  for (const feature of keptFeatures) ancestorModules.add(feature.moduleId);

  const finalModules = input.modules.filter(
    (m) => keptModuleIds.has(m.id) || ancestorModules.has(m.id)
  );
  const finalModuleIds = new Set(finalModules.map((m) => m.id));

  const productIds = new Set(matchedProducts);
  for (const moduleId of finalModuleIds) {
    const owner = moduleById.get(moduleId);
    if (owner) productIds.add(owner.productId);
  }

  const finalFeatures = keptFeatures.filter((f) => finalModuleIds.has(f.moduleId));
  const finalFeatureIds = new Set(finalFeatures.map((f) => f.id));
  const finalRequirements = matchedRequirements.filter((r) => finalFeatureIds.has(r.featureId));

  return {
    products: input.products.filter((p) => productIds.has(p.id)),
    modules: finalModules,
    features: finalFeatures,
    requirements: finalRequirements,
    // Everything that survived is open: see the note above.
    openProductIds: productIds,
    openModuleIds: finalModuleIds,
    // ...except a feature, which opens only because a requirement inside it matched.
    openFeatureIds: new Set(finalRequirements.map((r) => r.featureId)),
    matchCount
  };
}
