import { Prisma, QamsRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { ensureRole, RoleSets } from "@/lib/rbac";
import { ensureVersion, requireNonBlank, requireNonBlankIfProvided } from "@/lib/validation";
import { withVersionCheck } from "@/lib/optimistic-lock";
import { BUSINESS_ID_PATTERNS, ensureBusinessIdFormat } from "@/lib/business-ids";
import { appendAudit } from "@/lib/audit";
import { containsAny, runPaged, type PageRequest } from "@/lib/pagination";
import {
  assembleTree,
  countByParent,
  narrowToMatches,
  type CatalogueTree,
  type FeatureRow,
  type ModuleRow,
  type NodeRow
} from "./catalogue-tree";

type Actor = { userId: string; role: QamsRole; requestId: string };

/**
 * An in-flight transaction a caller already owns.
 *
 * The create functions below open their own transaction by default, which is right
 * for a route handler doing one thing. The workbook import is different: it must
 * "commit each dependency-consistent batch atomically"
 * (`docs/business-rules-and-validation.md:44`), so a per-row transaction would break
 * the property it is required to have. Accepting an existing client lets it call
 * these services from inside its batch instead of writing to Prisma directly, which
 * `docs/architecture.md:30` and `CLAUDE.md:52` both forbid.
 *
 * Every rule still runs — RBAC, non-blank checks, business-ID format, the duplicate
 * check and the audit event — because it is the same code path either way. That is
 * the entire point: one definition of what a valid Product is, not two.
 */
export type TxClient = Prisma.TransactionClient;

/** Run `fn` in the caller's transaction when there is one, otherwise open a new one. */
function runInTransaction<T>(
  tx: TxClient | undefined,
  fn: (client: TxClient) => Promise<T>
): Promise<T> {
  return tx ? fn(tx) : prisma.$transaction(fn);
}

/**
 * The flat, paged lists. `PageRequest` and no filter: these back the test-case drafting
 * form and the release-readiness picker, where the caller wants a page of a level rather
 * than a search across the hierarchy.
 *
 * Searching the catalogue is `listCatalogueTree` below, which is a different question —
 * it matches across all four levels at once and returns the matches in their place in the
 * tree. (Until the explorer screen existed this comment said the catalogue offered no
 * search box at all, and that adding one would be UI policy nobody asked for. The QA Lead
 * asked for one; the note is corrected rather than left contradicting the code beneath it.)
 */
export async function listProducts(options: PageRequest = {}) {
  return runPaged(
    options,
    (window) => prisma.product.findMany({ orderBy: { businessId: "asc" }, ...window }),
    () => prisma.product.count()
  );
}

/** Just enough of a parent to label a child row and fill an "Add" dropdown. */
const OPTION_SELECT = { id: true, businessId: true, name: true } as const;

/**
 * The parent options the catalogue screen needs whatever page it is on: a child row on
 * page 3 still has to name its parent, and the Add dialogs still have to offer every
 * possible parent. Deliberately NOT paged — but three columns per row rather than the
 * whole record, so the light thing is fetched in full and the heavy thing (the editable
 * rows, each carrying a server-action form) is what gets paged.
 */
export async function listCatalogueOptions() {
  const [products, modules, features] = await Promise.all([
    prisma.product.findMany({ select: OPTION_SELECT, orderBy: { businessId: "asc" } }),
    prisma.module.findMany({
      select: { ...OPTION_SELECT, productId: true },
      orderBy: { businessId: "asc" }
    }),
    prisma.feature.findMany({
      select: { ...OPTION_SELECT, moduleId: true },
      orderBy: { businessId: "asc" }
    })
  ]);
  return { products, modules, features };
}

/**
 * Products as filter options: every one, three columns, cheapest ordering.
 *
 * Separate from `listCatalogueOptions` because the list screens need only this third of
 * it — pulling modules and features to render one product dropdown is two queries and
 * two result sets thrown away on every page load. Unpaged: a dropdown that only offers
 * the first page of products is a filter that silently cannot reach some rows.
 */
export async function listProductOptions() {
  return prisma.product.findMany({ select: OPTION_SELECT, orderBy: { businessId: "asc" } });
}

/** Features as filter options, same shape and same reasoning as `listProductOptions`. */
export async function listFeatureOptions() {
  return prisma.feature.findMany({ select: OPTION_SELECT, orderBy: { businessId: "asc" } });
}

// ---------------------------------------------------------------------------
// The catalogue explorer's reads.
//
// Everything below is additive. The functions above back the test-case drafting form,
// the release-readiness picker and the `/api/v1` collection routes, and none of their
// signatures move — see `CATALOGUE-EXPLORER-REDESIGN.md` § 12.
//
// The shape of the answers is decided in `./catalogue-tree`, which is pure and tested
// without a database. These functions run the queries and hand rows over.
// ---------------------------------------------------------------------------

const BY_BUSINESS_ID = { businessId: "asc" } as const;

/** A count per parent id, from a Prisma `groupBy`. */
function countsFrom<K extends string>(
  rows: ReadonlyArray<Record<K, string> & { _count: { _all: number } }>,
  key: K
): Map<string, number> {
  return new Map(rows.map((row) => [row[key], row._count._all]));
}

/** The four totals for the header's stat cards. Counts only — no rows fetched. */
export async function catalogueTotals() {
  const [products, modules, features, requirements] = await Promise.all([
    prisma.product.count(),
    prisma.module.count(),
    prisma.feature.count(),
    prisma.requirement.count()
  ]);
  return { products, modules, features, requirements };
}

/**
 * The explorer's tree.
 *
 * Two modes, one return shape.
 *
 * **Browsing** (no needle) is lazy: every product with its module count, then the modules
 * of the one open product, then the features of the one open module. A catalogue with 40
 * products and 900 features costs 40 rows plus one branch — not 900. This is what the
 * redesign means by "virtualization-ready": the depth of the fetch follows the depth of
 * what is actually open.
 *
 * **Searching** fetches the whole spine (three light queries of three columns) and filters
 * it in `narrowToMatches`, because a match has to be shown under its real ancestors and
 * resolving those one recursive query at a time would be slower and far harder to test.
 * That is the same volume `listCatalogueOptions` already pulls on every load of the
 * current screen, so it is not a new cost.
 *
 * Requirements are matched too, but they are not tree nodes: a requirement hit comes back
 * as its feature. Only their `featureId` is selected, so a needle matching a thousand
 * requirements still returns a handful of ids.
 */
export async function listCatalogueTree(options: {
  q?: string;
  openProductId?: string;
  openModuleId?: string;
} = {}): Promise<CatalogueTree> {
  const needle = (options.q ?? "").trim();

  if (needle !== "") return searchCatalogueTree(needle);

  const [products, moduleCountRows] = await Promise.all([
    prisma.product.findMany({ select: OPTION_SELECT, orderBy: BY_BUSINESS_ID }),
    prisma.module.groupBy({ by: ["productId"], _count: { _all: true } })
  ]);

  const modules: ModuleRow[] = options.openProductId
    ? await prisma.module.findMany({
        where: { productId: options.openProductId },
        select: { ...OPTION_SELECT, productId: true },
        orderBy: BY_BUSINESS_ID
      })
    : [];

  // Counted for the open branch only: a closed product's modules are not drawn, so their
  // feature counts are not needed and would be a table-wide grouping to get them.
  const featureCountRows = modules.length
    ? await prisma.feature.groupBy({
        by: ["moduleId"],
        where: { moduleId: { in: modules.map((m) => m.id) } },
        _count: { _all: true }
      })
    : [];

  const features: FeatureRow[] = options.openModuleId
    ? await prisma.feature.findMany({
        where: { moduleId: options.openModuleId },
        select: { ...OPTION_SELECT, moduleId: true },
        orderBy: BY_BUSINESS_ID
      })
    : [];

  const requirementCountRows = features.length
    ? await prisma.requirement.groupBy({
        by: ["featureId"],
        where: { featureId: { in: features.map((f) => f.id) } },
        _count: { _all: true }
      })
    : [];

  return assembleTree({
    products,
    modules,
    features,
    moduleCounts: countsFrom(moduleCountRows, "productId"),
    featureCounts: countsFrom(featureCountRows, "moduleId"),
    requirementCounts: countsFrom(requirementCountRows, "featureId"),
    openProductIds: options.openProductId ? new Set([options.openProductId]) : new Set(),
    openModuleIds: options.openModuleId ? new Set([options.openModuleId]) : new Set()
  });
}

async function searchCatalogueTree(needle: string): Promise<CatalogueTree> {
  const [products, modules, features, requirementHits] = await Promise.all([
    prisma.product.findMany({ select: OPTION_SELECT, orderBy: BY_BUSINESS_ID }),
    prisma.module.findMany({
      select: { ...OPTION_SELECT, productId: true },
      orderBy: BY_BUSINESS_ID
    }),
    prisma.feature.findMany({
      select: { ...OPTION_SELECT, moduleId: true },
      orderBy: BY_BUSINESS_ID
    }),
    prisma.requirement.findMany({
      where: containsAny(needle, ["businessId", "statement"]),
      select: { featureId: true },
      distinct: ["featureId"]
    })
  ]);

  const narrowed = narrowToMatches({
    products: products as NodeRow[],
    modules,
    features,
    needle,
    featureIdsFromRequirements: new Set(requirementHits.map((row) => row.featureId))
  });

  // Requirement counts are the one number the narrowed rows cannot supply themselves —
  // and only for the features that survived, which is a bounded set.
  const requirementCountRows = narrowed.features.length
    ? await prisma.requirement.groupBy({
        by: ["featureId"],
        where: { featureId: { in: narrowed.features.map((f) => f.id) } },
        _count: { _all: true }
      })
    : [];

  return assembleTree({
    products: narrowed.products,
    modules: narrowed.modules,
    features: narrowed.features,
    // In search mode a badge counts MATCHING children, not every child — the tree is
    // showing a filtered catalogue and the numbers have to describe what is on screen.
    moduleCounts: countByParent(narrowed.modules, (m) => m.productId),
    featureCounts: countByParent(narrowed.features, (f) => f.moduleId),
    requirementCounts: countsFrom(requirementCountRows, "featureId"),
    openProductIds: narrowed.openProductIds,
    openModuleIds: narrowed.openModuleIds,
    matchCount: narrowed.matchCount
  });
}

/** One row of the detail panel's child list. */
export type DetailChild = {
  id: string;
  businessId: string;
  /** A name, or — for a requirement — its statement. */
  label: string;
  /** Grandchildren under this row. `null` for a requirement, which is a leaf. */
  count: number | null;
  version: number;
  updatedAt: Date;
};

/**
 * The selected record, everything the header states about it, and its children.
 *
 * One shape for all three selectable levels, so the detail panel is one component rather
 * than three near-copies. Two fields exist because of what the data model does NOT have
 * (see `CATALOGUE-EXPLORER-REDESIGN.md` § 0.5):
 *
 * - `product` carries `versionTag` and `status`, which live on Product alone. A module or
 *   feature header shows them as INHERITED context and must label them that way — they
 *   are not the module's own status, and there is no such thing.
 * - `updatedByName` stands in for an owner. There is no owner column on any of the four
 *   models; adding one is a `docs/data-model.md` change, not a screen change.
 */
export type CatalogueDetail = {
  kind: "product" | "module" | "feature";
  id: string;
  businessId: string;
  title: string;
  /** The optimistic-lock counter, not a release version. Shown as "record version". */
  version: number;
  updatedAt: Date;
  updatedByName: string | null;
  /** Ancestors, outermost first. Empty for a product. */
  trail: Array<{ kind: "product" | "module"; businessId: string; name: string }>;
  product: { businessId: string; name: string; versionTag: string; status: string };
  /** Rollups for the header. `null` where the level has no such number. */
  stats: { modules: number | null; features: number | null; requirements: number };
  childKind: "module" | "feature" | "requirement";
  children: DetailChild[];
  /** Children BEFORE paging. Only a feature's requirement list is paged. */
  childTotal: number;
};

/**
 * `updatedBy` holds a user id. Resolving it is a separate lookup rather than a relation,
 * because the four catalogue models store the id as a plain column with no foreign key —
 * the workbook import writes rows whose author may not be a User at all, so a missing
 * name is a normal answer here, not an error.
 */
async function displayNameOf(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { displayName: true }
  });
  return user?.displayName ?? null;
}

export async function getProductDetail(businessId: string): Promise<CatalogueDetail> {
  const product = await prisma.product.findUnique({ where: { businessId } });
  if (!product) throw new AppError(404, "REFERENCE_NOT_FOUND", "Product not found.", "businessId");

  const [modules, featureTotal, requirementTotal, updatedByName] = await Promise.all([
    prisma.module.findMany({
      where: { productId: product.id },
      select: { id: true, businessId: true, name: true, version: true, updatedAt: true },
      orderBy: BY_BUSINESS_ID
    }),
    prisma.feature.count({ where: { module: { productId: product.id } } }),
    prisma.requirement.count({ where: { feature: { module: { productId: product.id } } } }),
    displayNameOf(product.updatedBy)
  ]);

  const featureCounts = countsFrom(
    modules.length
      ? await prisma.feature.groupBy({
          by: ["moduleId"],
          where: { moduleId: { in: modules.map((m) => m.id) } },
          _count: { _all: true }
        })
      : [],
    "moduleId"
  );

  return {
    kind: "product",
    id: product.id,
    businessId: product.businessId,
    title: product.name,
    version: product.version,
    updatedAt: product.updatedAt,
    updatedByName,
    trail: [],
    product: {
      businessId: product.businessId,
      name: product.name,
      versionTag: product.versionTag,
      status: product.status
    },
    stats: { modules: modules.length, features: featureTotal, requirements: requirementTotal },
    childKind: "module",
    children: modules.map((row) => ({
      id: row.id,
      businessId: row.businessId,
      label: row.name,
      count: featureCounts.get(row.id) ?? 0,
      version: row.version,
      updatedAt: row.updatedAt
    })),
    childTotal: modules.length
  };
}

export async function getModuleDetail(businessId: string): Promise<CatalogueDetail> {
  const moduleRow = await prisma.module.findUnique({
    where: { businessId },
    include: { product: true }
  });
  if (!moduleRow) throw new AppError(404, "REFERENCE_NOT_FOUND", "Module not found.", "businessId");

  const [features, requirementTotal, updatedByName] = await Promise.all([
    prisma.feature.findMany({
      where: { moduleId: moduleRow.id },
      select: { id: true, businessId: true, name: true, version: true, updatedAt: true },
      orderBy: BY_BUSINESS_ID
    }),
    prisma.requirement.count({ where: { feature: { moduleId: moduleRow.id } } }),
    displayNameOf(moduleRow.updatedBy)
  ]);

  const requirementCounts = countsFrom(
    features.length
      ? await prisma.requirement.groupBy({
          by: ["featureId"],
          where: { featureId: { in: features.map((f) => f.id) } },
          _count: { _all: true }
        })
      : [],
    "featureId"
  );

  return {
    kind: "module",
    id: moduleRow.id,
    businessId: moduleRow.businessId,
    title: moduleRow.name,
    version: moduleRow.version,
    updatedAt: moduleRow.updatedAt,
    updatedByName,
    trail: [
      { kind: "product", businessId: moduleRow.product.businessId, name: moduleRow.product.name }
    ],
    product: {
      businessId: moduleRow.product.businessId,
      name: moduleRow.product.name,
      versionTag: moduleRow.product.versionTag,
      status: moduleRow.product.status
    },
    stats: { modules: null, features: features.length, requirements: requirementTotal },
    childKind: "feature",
    children: features.map((row) => ({
      id: row.id,
      businessId: row.businessId,
      label: row.name,
      count: requirementCounts.get(row.id) ?? 0,
      version: row.version,
      updatedAt: row.updatedAt
    })),
    childTotal: features.length
  };
}

/**
 * A feature and its requirements — the one child list that is paged.
 *
 * Requirements are the highest-cardinality level and their label is a sentence, which is
 * exactly why they are rows here rather than tree nodes. A feature carrying fifty of them
 * would otherwise reintroduce the scrolling the redesign removes.
 */
export async function getFeatureDetail(
  businessId: string,
  options: PageRequest = {}
): Promise<CatalogueDetail> {
  const feature = await prisma.feature.findUnique({
    where: { businessId },
    include: { module: { include: { product: true } } }
  });
  if (!feature) throw new AppError(404, "REFERENCE_NOT_FOUND", "Feature not found.", "businessId");

  const [requirements, updatedByName] = await Promise.all([
    runPaged(
      options,
      (window) =>
        prisma.requirement.findMany({
          where: { featureId: feature.id },
          select: { id: true, businessId: true, statement: true, version: true, updatedAt: true },
          orderBy: BY_BUSINESS_ID,
          ...window
        }),
      () => prisma.requirement.count({ where: { featureId: feature.id } })
    ),
    displayNameOf(feature.updatedBy)
  ]);

  const { product } = feature.module;

  return {
    kind: "feature",
    id: feature.id,
    businessId: feature.businessId,
    title: feature.name,
    version: feature.version,
    updatedAt: feature.updatedAt,
    updatedByName,
    trail: [
      { kind: "product", businessId: product.businessId, name: product.name },
      { kind: "module", businessId: feature.module.businessId, name: feature.module.name }
    ],
    product: {
      businessId: product.businessId,
      name: product.name,
      versionTag: product.versionTag,
      status: product.status
    },
    stats: { modules: null, features: null, requirements: requirements.total },
    childKind: "requirement",
    children: requirements.rows.map((row) => ({
      id: row.id,
      businessId: row.businessId,
      label: row.statement,
      count: null,
      version: row.version,
      updatedAt: row.updatedAt
    })),
    childTotal: requirements.total
  };
}

// The single-record getters exist so route handlers never touch the ORM directly
// (`architecture.md:33`) and a missing record surfaces through the standard error
// shape, requestId included (`api-and-security.md:22-31`) — implementation audit §4.2.
export async function getProduct(id: string) {
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) throw new AppError(404, "REFERENCE_NOT_FOUND", "Product not found.", "id");
  return product;
}

export async function createProduct(
  input: { businessId: string; name: string; versionTag: string; status: string },
  actor: Actor,
  txClient?: TxClient
) {
  ensureRole([...RoleSets.canAdmin], actor.role);
  requireNonBlank(input.businessId, "businessId", "Product ID is required.");
  requireNonBlank(input.name, "name", "Product name is required.");
  requireNonBlank(input.versionTag, "versionTag", "Version is required.");
  requireNonBlank(input.status, "status", "Status is required.");
  ensureBusinessIdFormat(input.businessId, BUSINESS_ID_PATTERNS.product, "businessId", "PROD###");

  const existing = await (txClient ?? prisma).product.findUnique({
    where: { businessId: input.businessId }
  });
  if (existing) {
    throw new AppError(409, "ID_DUPLICATE", "Product ID already exists.", "businessId");
  }

  return runInTransaction(txClient, async (tx) => {
    const created = await tx.product.create({
      data: {
        businessId: input.businessId.trim(),
        name: input.name.trim(),
        versionTag: input.versionTag.trim(),
        status: input.status.trim(),
        createdBy: actor.userId,
        updatedBy: actor.userId
      }
    });

    await appendAudit(tx, {
      actorId: actor.userId,
      action: "PRODUCT_CREATED",
      entityType: "Product",
      entityId: created.id,
      requestId: actor.requestId,
      beforeAfterJson: { after: created }
    });

    return created;
  });
}

export async function updateProduct(
  id: string,
  input: { name?: string; versionTag?: string; status?: string; version?: number },
  actor: Actor
) {
  ensureRole([...RoleSets.canAdmin], actor.role);
  requireNonBlankIfProvided(input.name, "name", "Product name cannot be blank.");
  requireNonBlankIfProvided(input.versionTag, "versionTag", "Version cannot be blank.");
  requireNonBlankIfProvided(input.status, "status", "Status cannot be blank.");
  const current = await prisma.product.findUnique({ where: { id } });
  if (!current) throw new AppError(404, "REFERENCE_NOT_FOUND", "Product not found.", "id");
  const expectedVersion = ensureVersion(current.version, input.version);

  return withVersionCheck(() => prisma.$transaction(async (tx) => {
    const updated = await tx.product.update({
      where: { id, version: expectedVersion },
      data: {
        name: input.name?.trim() ?? current.name,
        versionTag: input.versionTag?.trim() ?? current.versionTag,
        status: input.status?.trim() ?? current.status,
        version: { increment: 1 },
        updatedBy: actor.userId
      }
    });
    await appendAudit(tx, {
      actorId: actor.userId,
      action: "PRODUCT_UPDATED",
      entityType: "Product",
      entityId: id,
      requestId: actor.requestId,
      beforeAfterJson: { before: current, after: updated }
    });
    return updated;
  }));
}

export async function getModule(id: string) {
  const row = await prisma.module.findUnique({ where: { id } });
  if (!row) throw new AppError(404, "REFERENCE_NOT_FOUND", "Module not found.", "id");
  return row;
}

export async function listModules(options: PageRequest = {}) {
  return runPaged(
    options,
    (window) => prisma.module.findMany({ orderBy: { businessId: "asc" }, ...window }),
    () => prisma.module.count()
  );
}

export async function createModule(
  input: { businessId: string; name: string; productId: string },
  actor: Actor,
  txClient?: TxClient
) {
  ensureRole([...RoleSets.canAdmin], actor.role);
  requireNonBlank(input.businessId, "businessId", "Module ID is required.");
  requireNonBlank(input.name, "name", "Module name is required.");
  ensureBusinessIdFormat(input.businessId, BUSINESS_ID_PATTERNS.module, "businessId", "MOD###");

  const db = txClient ?? prisma;
  const product = await db.product.findUnique({ where: { id: input.productId } });
  if (!product) throw new AppError(404, "REFERENCE_NOT_FOUND", "Product not found.", "productId");

  const existing = await db.module.findUnique({ where: { businessId: input.businessId } });
  if (existing) throw new AppError(409, "ID_DUPLICATE", "Module ID already exists.", "businessId");

  return runInTransaction(txClient, async (tx) => {
    const created = await tx.module.create({
      data: {
        businessId: input.businessId.trim(),
        name: input.name.trim(),
        productId: input.productId,
        createdBy: actor.userId,
        updatedBy: actor.userId
      }
    });
    await appendAudit(tx, {
      actorId: actor.userId,
      action: "MODULE_CREATED",
      entityType: "Module",
      entityId: created.id,
      requestId: actor.requestId,
      beforeAfterJson: { after: created }
    });
    return created;
  });
}

export async function updateModule(id: string, input: { name?: string; version?: number }, actor: Actor) {
  ensureRole([...RoleSets.canAdmin], actor.role);
  requireNonBlankIfProvided(input.name, "name", "Module name cannot be blank.");
  const current = await prisma.module.findUnique({ where: { id } });
  if (!current) throw new AppError(404, "REFERENCE_NOT_FOUND", "Module not found.", "id");
  const expectedVersion = ensureVersion(current.version, input.version);

  return withVersionCheck(() => prisma.$transaction(async (tx) => {
    const updated = await tx.module.update({
      where: { id, version: expectedVersion },
      data: { name: input.name?.trim() ?? current.name, version: { increment: 1 }, updatedBy: actor.userId }
    });
    await appendAudit(tx, {
      actorId: actor.userId,
      action: "MODULE_UPDATED",
      entityType: "Module",
      entityId: id,
      requestId: actor.requestId,
      beforeAfterJson: { before: current, after: updated }
    });
    return updated;
  }));
}

export async function getFeature(id: string) {
  const row = await prisma.feature.findUnique({ where: { id } });
  if (!row) throw new AppError(404, "REFERENCE_NOT_FOUND", "Feature not found.", "id");
  return row;
}

export async function listFeatures(options: PageRequest = {}) {
  return runPaged(
    options,
    (window) => prisma.feature.findMany({ orderBy: { businessId: "asc" }, ...window }),
    () => prisma.feature.count()
  );
}

export async function createFeature(
  input: { businessId: string; name: string; moduleId: string },
  actor: Actor,
  txClient?: TxClient
) {
  ensureRole([...RoleSets.canAdmin], actor.role);
  requireNonBlank(input.businessId, "businessId", "Feature ID is required.");
  requireNonBlank(input.name, "name", "Feature name is required.");
  ensureBusinessIdFormat(input.businessId, BUSINESS_ID_PATTERNS.feature, "businessId", "FEAT###");

  const db = txClient ?? prisma;
  const parentModule = await db.module.findUnique({ where: { id: input.moduleId } });
  if (!parentModule) throw new AppError(404, "REFERENCE_NOT_FOUND", "Module not found.", "moduleId");

  const existing = await db.feature.findUnique({ where: { businessId: input.businessId } });
  if (existing) throw new AppError(409, "ID_DUPLICATE", "Feature ID already exists.", "businessId");

  return runInTransaction(txClient, async (tx) => {
    const created = await tx.feature.create({
      data: {
        businessId: input.businessId.trim(),
        name: input.name.trim(),
        moduleId: input.moduleId,
        createdBy: actor.userId,
        updatedBy: actor.userId
      }
    });
    await appendAudit(tx, {
      actorId: actor.userId,
      action: "FEATURE_CREATED",
      entityType: "Feature",
      entityId: created.id,
      requestId: actor.requestId,
      beforeAfterJson: { after: created }
    });
    return created;
  });
}

export async function updateFeature(id: string, input: { name?: string; version?: number }, actor: Actor) {
  ensureRole([...RoleSets.canAdmin], actor.role);
  requireNonBlankIfProvided(input.name, "name", "Feature name cannot be blank.");
  const current = await prisma.feature.findUnique({ where: { id } });
  if (!current) throw new AppError(404, "REFERENCE_NOT_FOUND", "Feature not found.", "id");
  const expectedVersion = ensureVersion(current.version, input.version);

  return withVersionCheck(() => prisma.$transaction(async (tx) => {
    const updated = await tx.feature.update({
      where: { id, version: expectedVersion },
      data: { name: input.name?.trim() ?? current.name, version: { increment: 1 }, updatedBy: actor.userId }
    });
    await appendAudit(tx, {
      actorId: actor.userId,
      action: "FEATURE_UPDATED",
      entityType: "Feature",
      entityId: id,
      requestId: actor.requestId,
      beforeAfterJson: { before: current, after: updated }
    });
    return updated;
  }));
}

export async function getRequirement(id: string) {
  const row = await prisma.requirement.findUnique({ where: { id } });
  if (!row) throw new AppError(404, "REFERENCE_NOT_FOUND", "Requirement not found.", "id");
  return row;
}

export async function listRequirements(options: PageRequest = {}) {
  return runPaged(
    options,
    (window) => prisma.requirement.findMany({ orderBy: { businessId: "asc" }, ...window }),
    () => prisma.requirement.count()
  );
}

export async function createRequirement(
  input: { businessId: string; statement: string; featureId: string },
  actor: Actor,
  txClient?: TxClient
) {
  ensureRole([...RoleSets.canAdmin], actor.role);
  requireNonBlank(input.businessId, "businessId", "Requirement ID is required.");
  requireNonBlank(input.statement, "statement", "Requirement statement is required.");
  ensureBusinessIdFormat(input.businessId, BUSINESS_ID_PATTERNS.requirement, "businessId", "REQ###");

  const db = txClient ?? prisma;
  const feature = await db.feature.findUnique({ where: { id: input.featureId } });
  if (!feature) throw new AppError(404, "REFERENCE_NOT_FOUND", "Feature not found.", "featureId");

  const existing = await db.requirement.findUnique({ where: { businessId: input.businessId } });
  if (existing) throw new AppError(409, "ID_DUPLICATE", "Requirement ID already exists.", "businessId");

  return runInTransaction(txClient, async (tx) => {
    const created = await tx.requirement.create({
      data: {
        businessId: input.businessId.trim(),
        statement: input.statement.trim(),
        featureId: input.featureId,
        createdBy: actor.userId,
        updatedBy: actor.userId
      }
    });
    await appendAudit(tx, {
      actorId: actor.userId,
      action: "REQUIREMENT_CREATED",
      entityType: "Requirement",
      entityId: created.id,
      requestId: actor.requestId,
      beforeAfterJson: { after: created }
    });
    return created;
  });
}

export async function updateRequirement(
  id: string,
  input: { statement?: string; version?: number },
  actor: Actor
) {
  ensureRole([...RoleSets.canAdmin], actor.role);
  requireNonBlankIfProvided(input.statement, "statement", "Requirement statement cannot be blank.");
  const current = await prisma.requirement.findUnique({ where: { id } });
  if (!current) throw new AppError(404, "REFERENCE_NOT_FOUND", "Requirement not found.", "id");
  const expectedVersion = ensureVersion(current.version, input.version);

  return withVersionCheck(() => prisma.$transaction(async (tx) => {
    const updated = await tx.requirement.update({
      where: { id, version: expectedVersion },
      data: { statement: input.statement?.trim() ?? current.statement, version: { increment: 1 }, updatedBy: actor.userId }
    });
    await appendAudit(tx, {
      actorId: actor.userId,
      action: "REQUIREMENT_UPDATED",
      entityType: "Requirement",
      entityId: id,
      requestId: actor.requestId,
      beforeAfterJson: { before: current, after: updated }
    });
    return updated;
  }));
}
