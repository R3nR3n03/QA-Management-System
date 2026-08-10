import { Prisma, QamsRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { ensureRole, RoleSets } from "@/lib/rbac";
import { ensureVersion, requireNonBlank, requireNonBlankIfProvided } from "@/lib/validation";
import { withVersionCheck } from "@/lib/optimistic-lock";
import { BUSINESS_ID_PATTERNS, ensureBusinessIdFormat } from "@/lib/business-ids";
import { allocateBusinessId, highestSuffix, type AllocatorFormat } from "@/lib/id-allocator";
import { appendAudit } from "@/lib/audit";
import { containsAny, runPaged, type PageRequest } from "@/lib/pagination";
import {
  DEFAULT_SEARCH_LIMIT,
  rankHits,
  type SearchAncestor,
  type SearchHit,
  type SearchResults
} from "./catalogue-search";
import {
  assembleTree,
  DEFAULT_CHILD_LIMIT,
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
 * Allocator wiring for the four catalogue levels.
 *
 * ## Why these exist now
 *
 * `docs/data-model.md:5` has always required it: "Business IDs are allocated by the system
 * when the creating request does not supply one." Executions, defects and test cases have
 * done that since the allocator was written; the four catalogue levels never did, and
 * `requireNonBlank(input.businessId, …)` made a hand-typed ID mandatory instead. That was a
 * standing breach of the rule, not a policy choice.
 *
 * The blocker was arithmetic. All four levels are THREE digits — `PROD###`, `MOD###`,
 * `FEAT###`, `REQ###` — while the allocator hard-coded a four-digit suffix, so it would have
 * produced `REQ0001` and `ensureBusinessIdFormat` would have rejected it on the next line.
 * `AllocatorFormat.width` is what unblocked this.
 *
 * ## The 999 ceiling
 *
 * Three digits caps each level at 999 records. That is a real limit and it bites requirements
 * first — `docs/adr/0001-catalogue-tree-stops-at-feature.md` notes they "outnumber the other
 * three levels several times over, and that ratio grows". Widening to `REQ####` is a change
 * to `docs/data-model.md` and belongs to the QA Lead, so it is deliberately NOT smuggled in
 * here: an exhausted space surfaces as `ID_INVALID` naming the ceiling, which is the honest
 * failure rather than a silently different format.
 *
 * One sequence per level, keyed by entity type, matching the `"defect"` / `"execution"` keys.
 */
function catalogueIdFormat(
  prefix: string,
  ids: () => Promise<string[]>,
  isTaken: (candidate: string) => Promise<boolean>
): AllocatorFormat {
  // Width 3 for every catalogue level; see the note above.
  return { prefix, width: 3, isTaken, currentMax: async () => highestSuffix(prefix, await ids()) };
}

function productIdFormat(tx: TxClient): AllocatorFormat {
  return catalogueIdFormat(
    "PROD",
    async () => (await tx.product.findMany({ select: { businessId: true } })).map((r) => r.businessId),
    async (candidate) =>
      (await tx.product.findUnique({ where: { businessId: candidate }, select: { id: true } })) !== null
  );
}

function moduleIdFormat(tx: TxClient): AllocatorFormat {
  return catalogueIdFormat(
    "MOD",
    async () => (await tx.module.findMany({ select: { businessId: true } })).map((r) => r.businessId),
    async (candidate) =>
      (await tx.module.findUnique({ where: { businessId: candidate }, select: { id: true } })) !== null
  );
}

function featureIdFormat(tx: TxClient): AllocatorFormat {
  return catalogueIdFormat(
    "FEAT",
    async () => (await tx.feature.findMany({ select: { businessId: true } })).map((r) => r.businessId),
    async (candidate) =>
      (await tx.feature.findUnique({ where: { businessId: candidate }, select: { id: true } })) !== null
  );
}

function requirementIdFormat(tx: TxClient): AllocatorFormat {
  return catalogueIdFormat(
    "REQ",
    async () => (await tx.requirement.findMany({ select: { businessId: true } })).map((r) => r.businessId),
    async (candidate) =>
      (await tx.requirement.findUnique({ where: { businessId: candidate }, select: { id: true } })) !== null
  );
}

/**
 * The supplied business ID, validated — or `undefined`, meaning "allocate one".
 *
 * `undefined` and `""` are different requests and must stay different. Omitting the field
 * asks the system to generate an ID; sending a blank string is a form submitting an empty
 * input, which is a mistake and is still rejected. Both used to be rejected together.
 */
function suppliedBusinessId(
  raw: string | undefined,
  pattern: RegExp,
  documentedFormat: string,
  blankMessage: string
): string | undefined {
  if (raw === undefined) return undefined;
  requireNonBlank(raw, "businessId", blankMessage);
  ensureBusinessIdFormat(raw, pattern, "businessId", documentedFormat);
  return raw.trim();
}

/**
 * The flat, paged lists. `PageRequest` and no filter: these back the test-case drafting
 * form and the release-readiness picker, where the caller wants a page of a level rather
 * than a search across the hierarchy.
 *
 * Searching the catalogue is `searchCatalogue` below, which is a different question — it
 * matches across all four levels at once and returns a ranked, bounded list of hits with
 * their ancestry. (Until the explorer screen existed this comment said the catalogue
 * offered no search box at all, and that adding one would be UI policy nobody asked for.
 * The QA Lead asked for one; the note is corrected rather than left contradicting the code
 * beneath it.)
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
 * Products as filter options: every one, three columns, cheapest ordering.
 *
 * Unpaged: a dropdown that only offers the first page of products is a filter that
 * silently cannot reach some rows.
 *
 * There was a `listCatalogueOptions` beside this that fetched every product, module AND
 * feature in one go, for the catalogue explorer's create dialogs. It is gone. The explorer
 * always knows the parent from the selection and states it (`locked-parent`), so the
 * dropdowns those three result sets fed were never rendered — three unbounded table reads
 * on every load of the screen, feeding props nothing displayed.
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
 * The explorer's tree: Product → Module → Feature.
 *
 * Lazy by branch AND bounded by branch, which are two different economies and the tree
 * needs both:
 *
 * - **Lazy**: every product with its module count, then the modules of the OPEN products,
 *   then the features of the OPEN modules. A catalogue with 40 products and 900 features
 *   costs 40 rows plus one branch per level, not 900. The depth of the fetch follows the
 *   depth of what is actually open, and `MAX_OPEN_NODES` bounds how many that can be.
 * - **Bounded**: one branch draws at most `childLimit` children, however many it has
 *   (`assembleTree`). Laziness alone does not save a tree from a single module with 400
 *   features — it just means you pay for it after one click rather than none.
 *
 * The fourth level is gone. Requirements are not tree nodes: they are read in the
 * feature's detail panel, which pages them, and found through `searchCatalogue`, which
 * ranks and bounds them. See `docs/adr/0001-catalogue-tree-stops-at-feature.md`.
 *
 * Searching is NOT this function any more — see `searchCatalogue`.
 */
export async function listCatalogueTree(options: {
  /** A single open branch per level — the shape the acceptance tests drive. */
  openProductId?: string;
  openModuleId?: string;
  /**
   * Every open branch per level, which is what the screen passes.
   *
   * Plural because expansion is not derived from one selected record's ancestor path: the
   * viewer expands branches independently of what is selected, so any number can be open
   * at once. Unioned with the singular options above.
   */
  openProductIds?: readonly string[];
  openModuleIds?: readonly string[];
  /** Children per branch. Defaults to `DEFAULT_CHILD_LIMIT`. */
  childLimit?: number;
} = {}): Promise<CatalogueTree> {
  const openProducts = union(options.openProductIds, options.openProductId);
  const openModules = union(options.openModuleIds, options.openModuleId);

  const childLimit = options.childLimit ?? DEFAULT_CHILD_LIMIT;

  const [products, moduleCountRows] = await Promise.all([
    // `take` bounds the ROOT the same way the assembler bounds a branch, so a catalogue
    // that grows to 400 products cannot ship 400 rows before anyone expands anything.
    // One over the cap: that extra row is how we know whether there is anything past it.
    prisma.product.findMany({
      select: OPTION_SELECT,
      orderBy: BY_BUSINESS_ID,
      take: childLimit + 1
    }),
    prisma.module.groupBy({ by: ["productId"], _count: { _all: true } })
  ]);

  // Only when the root actually overflowed. In every other case the rows we hold ARE the
  // total, and a COUNT(*) to learn that would be a wasted round trip on every page load.
  const productTotal =
    products.length > childLimit ? await prisma.product.count() : products.length;

  const modules: ModuleRow[] = openProducts.size
    ? await prisma.module.findMany({
        where: { productId: { in: [...openProducts] } },
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

  const features: FeatureRow[] = openModules.size
    ? await prisma.feature.findMany({
        where: { moduleId: { in: [...openModules] } },
        select: { ...OPTION_SELECT, moduleId: true },
        orderBy: BY_BUSINESS_ID
      })
    : [];

  // The badge beside a feature. Counted for the features actually drawn, which is a set
  // bounded by the open modules — never the requirement table, which is the level that
  // outnumbers the other three several times over.
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
    openProductIds: openProducts,
    openModuleIds: openModules,
    childLimit: options.childLimit,
    productTotal
  });
}

/** The plural option and the singular one as one set, ignoring blanks. */
function union(many: readonly string[] | undefined, one: string | undefined): Set<string> {
  const out = new Set<string>(many ?? []);
  if (one) out.add(one);
  out.delete("");
  return out;
}

/**
 * The row ids behind a set of business IDs, split by level.
 *
 * The tree opens branches by row id; the URL carries business IDs, because those are what
 * a person reads and pastes (`selection.ts`). This is the one lookup between them. IDs are
 * sorted into levels by their own format first, so each query asks only for rows that
 * could match — three indexed `IN` lookups on a `@unique` column, and none at all for a
 * level nothing is open at.
 *
 * Unknown IDs simply return nothing. A stale `?open=MOD999` is a branch that is not there
 * any more, which is a tree with one fewer branch open — not an error.
 */
export async function resolveOpenIds(businessIds: readonly string[]): Promise<{
  productIds: string[];
  moduleIds: string[];
}> {
  const forLevel = (pattern: RegExp) => businessIds.filter((id) => pattern.test(id));
  const productBids = forLevel(BUSINESS_ID_PATTERNS.product);
  const moduleBids = forLevel(BUSINESS_ID_PATTERNS.module);

  const idsOf = async (
    model: { findMany: (args: unknown) => Promise<Array<{ id: string }>> },
    bids: string[]
  ) =>
    bids.length
      ? (await model.findMany({ where: { businessId: { in: bids } }, select: { id: true } })).map(
          (row) => row.id
        )
      : [];

  const [productIds, moduleIds] = await Promise.all([
    idsOf(prisma.product as never, productBids),
    idsOf(prisma.module as never, moduleBids)
  ]);

  return { productIds, moduleIds };
}

/**
 * Records matching `needle`, across all four levels, best first.
 *
 * Four queries, each bounded by `LIMIT`, each carrying its own ancestry through a join.
 * The ranking is `rankHits` — pure, and tested without a database — because no single
 * `ORDER BY` can interleave four tables, and four separately-ordered result sets
 * concatenated would put every product above every requirement whatever was typed.
 *
 * ## What this replaced, and why it had to go
 *
 * Search used to build a filtered TREE: it read the whole Product, Module and Feature
 * tables (three columns each) on every committed keystroke, filtered them in JavaScript,
 * dragged each match's ancestors on screen, and force-expanded every branch that survived.
 * At the size the catalogue was written for that is fine and rather elegant. At three
 * thousand features it is three full table reads per keystroke rendered as a wall of
 * expanded rows in a 300px column.
 *
 * The ancestry those expanded branches existed to show is now one line per hit, which is
 * cheaper to produce and easier to read. See
 * `docs/adr/0002-catalogue-search-is-a-flat-ranked-list.md`.
 *
 * ## The cost that is left
 *
 * `containsAny` compiles to `ILIKE '%needle%'`, which no btree index can serve, so each
 * of the four queries is a sequential scan that stops early once `LIMIT` rows are found.
 * Bounded output, unbounded scan — acceptable at the size this catalogue is planned for
 * (`docs/adr/0002`), and the fix if it ever is not is a `pg_trgm` GIN index per searched
 * column, which is an additive migration and no change here.
 *
 * A blank needle is not a search: it returns nothing rather than the whole catalogue.
 */
export async function searchCatalogue(
  needle: string,
  options: { limit?: number } = {}
): Promise<SearchResults> {
  const trimmed = needle.trim();
  if (trimmed === "") return { hits: [], truncated: false };

  const limit = options.limit ?? DEFAULT_SEARCH_LIMIT;
  // One over, so `truncated` is answered by the rows themselves rather than by a
  // COUNT(*) on a predicate no index can serve.
  const take = limit + 1;

  const PRODUCT_CRUMB = { select: { businessId: true, name: true } } as const;

  const [products, modules, features, requirements] = await Promise.all([
    prisma.product.findMany({
      where: containsAny(trimmed, ["businessId", "name"]),
      select: { id: true, businessId: true, name: true },
      orderBy: BY_BUSINESS_ID,
      take
    }),
    prisma.module.findMany({
      where: containsAny(trimmed, ["businessId", "name"]),
      select: { id: true, businessId: true, name: true, product: PRODUCT_CRUMB },
      orderBy: BY_BUSINESS_ID,
      take
    }),
    prisma.feature.findMany({
      where: containsAny(trimmed, ["businessId", "name"]),
      select: {
        id: true,
        businessId: true,
        name: true,
        module: { select: { businessId: true, name: true, product: PRODUCT_CRUMB } }
      },
      orderBy: BY_BUSINESS_ID,
      take
    }),
    prisma.requirement.findMany({
      where: containsAny(trimmed, ["businessId", "statement"]),
      select: {
        id: true,
        businessId: true,
        statement: true,
        feature: {
          select: {
            businessId: true,
            name: true,
            module: { select: { businessId: true, name: true, product: PRODUCT_CRUMB } }
          }
        }
      },
      orderBy: BY_BUSINESS_ID,
      take
    })
  ]);

  const crumb = (
    kind: SearchAncestor["kind"],
    row: { businessId: string; name: string }
  ): SearchAncestor => ({ kind, businessId: row.businessId, name: row.name });

  const hits: SearchHit[] = [
    ...products.map((row) => ({
      kind: "product" as const,
      id: row.id,
      businessId: row.businessId,
      label: row.name,
      trail: []
    })),
    ...modules.map((row) => ({
      kind: "module" as const,
      id: row.id,
      businessId: row.businessId,
      label: row.name,
      trail: [crumb("product", row.product)]
    })),
    ...features.map((row) => ({
      kind: "feature" as const,
      id: row.id,
      businessId: row.businessId,
      label: row.name,
      trail: [crumb("product", row.module.product), crumb("module", row.module)]
    })),
    ...requirements.map((row) => ({
      kind: "requirement" as const,
      id: row.id,
      // A requirement has no name; its statement is its label, and it is a sentence.
      businessId: row.businessId,
      label: row.statement,
      trail: [
        crumb("product", row.feature.module.product),
        crumb("module", row.feature.module),
        crumb("feature", row.feature)
      ]
    }))
  ];

  return rankHits(hits, trimmed, limit);
}

/** A feature offered as a create target, with the ancestry that tells two apart. */
export type FeatureChoice = {
  id: string;
  businessId: string;
  name: string;
  /** `PROD001 Portal › MOD004 Upload` — the parent chain, already assembled for display. */
  path: string;
};

/**
 * Features matching a needle, for the requirement form's parent picker.
 *
 * ## Why not `listFeatureOptions`
 *
 * That returns every feature in one unpaged read and no ancestry. Both halves are wrong here.
 * `FEAT007 Upload` alone does not identify a feature once two products both have an upload
 * feature, and filing a requirement under the wrong one puts it in front of the wrong test
 * cases — so the path is not decoration, it is the disambiguator. And the tree caps branches
 * at `DEFAULT_CHILD_LIMIT` precisely because one module can hold hundreds of features
 * (`docs/adr/0001`), so a flat list of all of them is the read that was deleted from this
 * screen once already for being unbounded.
 *
 * ## Why not `searchCatalogue`
 *
 * That searches all four levels and ranks them together, which is right for the results list
 * and wasteful here: three of its four queries return rows this caller throws away. Same
 * `containsAny` predicate, same bounded `take`, one level.
 *
 * ## A blank needle lists the first page rather than nothing
 *
 * The opposite of `searchCatalogue`, deliberately. There, an empty needle is not a search and
 * returning the whole catalogue would be wrong. Here the picker opens before anything is
 * typed, and an empty picker cannot be browsed — someone who does not know the feature they
 * want (which is the case this exists for) has nothing to type yet. Bounded by the same
 * `limit`, so this is a first page, never the table.
 */
export async function searchFeatures(
  needle: string,
  options: { limit?: number } = {}
): Promise<FeatureChoice[]> {
  const trimmed = needle.trim();
  const limit = options.limit ?? DEFAULT_SEARCH_LIMIT;

  const rows = await prisma.feature.findMany({
    where: trimmed === "" ? undefined : containsAny(trimmed, ["businessId", "name"]),
    select: {
      id: true,
      businessId: true,
      name: true,
      module: { select: { businessId: true, name: true, product: { select: { businessId: true, name: true } } } }
    },
    orderBy: BY_BUSINESS_ID,
    take: limit
  });

  return rows.map((row) => ({
    id: row.id,
    businessId: row.businessId,
    name: row.name,
    path: `${row.module.product.businessId} ${row.module.product.name} › ${row.module.businessId} ${row.module.name}`
  }));
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
  kind: "product" | "module" | "feature" | "requirement";
  id: string;
  businessId: string;
  /** The record's name — for a requirement, its statement. */
  title: string;
  /** The optimistic-lock counter, not a release version. Shown as "record version". */
  version: number;
  updatedAt: Date;
  updatedByName: string | null;
  /** Ancestors, outermost first. Empty for a product. Business IDs, because the
   *  breadcrumb links with them (`?sel=p:PROD001`). */
  trail: Array<{ kind: "product" | "module" | "feature"; businessId: string; name: string }>;
  /**
   * The same ancestry as `trail`, but as row ids — which is what `listCatalogueTree`
   * opens branches by. Selecting a feature has to expand its module AND its product, and
   * the tree cannot derive that from a business ID without a second lookup.
   */
  path: { productId: string; moduleId: string | null; featureId: string | null };
  product: { businessId: string; name: string; versionTag: string; status: string };
  /** Rollups for the header. `null` where the level has no such number. */
  stats: { modules: number | null; features: number | null; requirements: number | null };
  /** `null` for a requirement, which is a leaf and has no child list. */
  childKind: "module" | "feature" | "requirement" | null;
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

/**
 * A product and its modules.
 *
 * Paged, like every child list on this screen. The tree draws at most `childLimit`
 * children per branch and points the rest here (`assembleTree`), so "here" has to be able
 * to hold them — an unpaged list would move a 300-module product from one unbounded render
 * to another.
 */
export async function getProductDetail(
  businessId: string,
  options: PageRequest = {}
): Promise<CatalogueDetail> {
  const product = await prisma.product.findUnique({ where: { businessId } });
  if (!product) throw new AppError(404, "REFERENCE_NOT_FOUND", "Product not found.", "businessId");

  const [modules, featureTotal, requirementTotal, updatedByName] = await Promise.all([
    runPaged(
      options,
      (window) =>
        prisma.module.findMany({
          where: { productId: product.id },
          select: { id: true, businessId: true, name: true, version: true, updatedAt: true },
          orderBy: BY_BUSINESS_ID,
          ...window
        }),
      () => prisma.module.count({ where: { productId: product.id } })
    ),
    prisma.feature.count({ where: { module: { productId: product.id } } }),
    prisma.requirement.count({ where: { feature: { module: { productId: product.id } } } }),
    displayNameOf(product.updatedBy)
  ]);

  const featureCounts = countsFrom(
    modules.rows.length
      ? await prisma.feature.groupBy({
          by: ["moduleId"],
          where: { moduleId: { in: modules.rows.map((m) => m.id) } },
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
    path: { productId: product.id, moduleId: null, featureId: null },
    product: {
      businessId: product.businessId,
      name: product.name,
      versionTag: product.versionTag,
      status: product.status
    },
    // The TOTAL, not the page: a header that says "12 modules" while the list beneath it
    // shows 50 of 300 is a header describing the pager rather than the product.
    stats: { modules: modules.total, features: featureTotal, requirements: requirementTotal },
    childKind: "module",
    children: modules.rows.map((row) => ({
      id: row.id,
      businessId: row.businessId,
      label: row.name,
      count: featureCounts.get(row.id) ?? 0,
      version: row.version,
      updatedAt: row.updatedAt
    })),
    childTotal: modules.total
  };
}

/** A module and its features. Paged, for the same reason as `getProductDetail`. */
export async function getModuleDetail(
  businessId: string,
  options: PageRequest = {}
): Promise<CatalogueDetail> {
  const moduleRow = await prisma.module.findUnique({
    where: { businessId },
    include: { product: true }
  });
  if (!moduleRow) throw new AppError(404, "REFERENCE_NOT_FOUND", "Module not found.", "businessId");

  const [features, requirementTotal, updatedByName] = await Promise.all([
    runPaged(
      options,
      (window) =>
        prisma.feature.findMany({
          where: { moduleId: moduleRow.id },
          select: { id: true, businessId: true, name: true, version: true, updatedAt: true },
          orderBy: BY_BUSINESS_ID,
          ...window
        }),
      () => prisma.feature.count({ where: { moduleId: moduleRow.id } })
    ),
    prisma.requirement.count({ where: { feature: { moduleId: moduleRow.id } } }),
    displayNameOf(moduleRow.updatedBy)
  ]);

  const requirementCounts = countsFrom(
    features.rows.length
      ? await prisma.requirement.groupBy({
          by: ["featureId"],
          where: { featureId: { in: features.rows.map((f) => f.id) } },
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
    path: { productId: moduleRow.productId, moduleId: moduleRow.id, featureId: null },
    product: {
      businessId: moduleRow.product.businessId,
      name: moduleRow.product.name,
      versionTag: moduleRow.product.versionTag,
      status: moduleRow.product.status
    },
    stats: { modules: null, features: features.total, requirements: requirementTotal },
    childKind: "feature",
    children: features.rows.map((row) => ({
      id: row.id,
      businessId: row.businessId,
      label: row.name,
      count: requirementCounts.get(row.id) ?? 0,
      version: row.version,
      updatedAt: row.updatedAt
    })),
    childTotal: features.total
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
    path: { productId: product.id, moduleId: feature.moduleId, featureId: feature.id },
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

/**
 * A requirement: the leaf of the hierarchy.
 *
 * The only detail with no child list — nothing hangs off a requirement in the catalogue.
 * Its `title` is its statement, which is a sentence rather than a name, so the panel is
 * where it is actually readable; a 300px tree row can only truncate it.
 */
export async function getRequirementDetail(businessId: string): Promise<CatalogueDetail> {
  const requirement = await prisma.requirement.findUnique({
    where: { businessId },
    include: { feature: { include: { module: { include: { product: true } } } } }
  });
  if (!requirement) {
    throw new AppError(404, "REFERENCE_NOT_FOUND", "Requirement not found.", "businessId");
  }

  const { feature } = requirement;
  const moduleRow = feature.module;
  const { product } = moduleRow;
  const updatedByName = await displayNameOf(requirement.updatedBy);

  return {
    kind: "requirement",
    id: requirement.id,
    businessId: requirement.businessId,
    title: requirement.statement,
    version: requirement.version,
    updatedAt: requirement.updatedAt,
    updatedByName,
    trail: [
      { kind: "product", businessId: product.businessId, name: product.name },
      { kind: "module", businessId: moduleRow.businessId, name: moduleRow.name },
      { kind: "feature", businessId: feature.businessId, name: feature.name }
    ],
    path: { productId: product.id, moduleId: moduleRow.id, featureId: feature.id },
    product: {
      businessId: product.businessId,
      name: product.name,
      versionTag: product.versionTag,
      status: product.status
    },
    stats: { modules: null, features: null, requirements: null },
    childKind: null,
    children: [],
    childTotal: 0
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
  input: { businessId?: string; name: string; versionTag: string; status: string },
  actor: Actor,
  txClient?: TxClient
) {
  ensureRole([...RoleSets.canAdmin], actor.role);
  requireNonBlank(input.name, "name", "Product name is required.");
  requireNonBlank(input.versionTag, "versionTag", "Version is required.");
  requireNonBlank(input.status, "status", "Status is required.");
  const suppliedId = suppliedBusinessId(
    input.businessId,
    BUSINESS_ID_PATTERNS.product,
    "PROD###",
    "Product ID cannot be blank."
  );

  if (suppliedId) {
    const existing = await (txClient ?? prisma).product.findUnique({
      where: { businessId: suppliedId }
    });
    if (existing) {
      throw new AppError(409, "ID_DUPLICATE", "Product ID already exists.", "businessId");
    }
  }

  return runInTransaction(txClient, async (tx) => {
    const businessId = suppliedId ?? (await allocateBusinessId(tx, "product", productIdFormat(tx)));
    const created = await tx.product.create({
      data: {
        businessId,
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
  input: { businessId?: string; name: string; productId: string },
  actor: Actor,
  txClient?: TxClient
) {
  ensureRole([...RoleSets.canAdmin], actor.role);
  requireNonBlank(input.name, "name", "Module name is required.");
  const suppliedId = suppliedBusinessId(
    input.businessId,
    BUSINESS_ID_PATTERNS.module,
    "MOD###",
    "Module ID cannot be blank."
  );

  const db = txClient ?? prisma;
  const product = await db.product.findUnique({ where: { id: input.productId } });
  if (!product) throw new AppError(404, "REFERENCE_NOT_FOUND", "Product not found.", "productId");

  if (suppliedId) {
    const existing = await db.module.findUnique({ where: { businessId: suppliedId } });
    if (existing) throw new AppError(409, "ID_DUPLICATE", "Module ID already exists.", "businessId");
  }

  return runInTransaction(txClient, async (tx) => {
    const businessId = suppliedId ?? (await allocateBusinessId(tx, "module", moduleIdFormat(tx)));
    const created = await tx.module.create({
      data: {
        businessId,
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
  input: { businessId?: string; name: string; moduleId: string },
  actor: Actor,
  txClient?: TxClient
) {
  ensureRole([...RoleSets.canAdmin], actor.role);
  requireNonBlank(input.name, "name", "Feature name is required.");
  const suppliedId = suppliedBusinessId(
    input.businessId,
    BUSINESS_ID_PATTERNS.feature,
    "FEAT###",
    "Feature ID cannot be blank."
  );

  const db = txClient ?? prisma;
  const parentModule = await db.module.findUnique({ where: { id: input.moduleId } });
  if (!parentModule) throw new AppError(404, "REFERENCE_NOT_FOUND", "Module not found.", "moduleId");

  if (suppliedId) {
    const existing = await db.feature.findUnique({ where: { businessId: suppliedId } });
    if (existing) throw new AppError(409, "ID_DUPLICATE", "Feature ID already exists.", "businessId");
  }

  return runInTransaction(txClient, async (tx) => {
    const businessId = suppliedId ?? (await allocateBusinessId(tx, "feature", featureIdFormat(tx)));
    const created = await tx.feature.create({
      data: {
        businessId,
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
  input: { businessId?: string; statement: string; featureId: string },
  actor: Actor,
  txClient?: TxClient
) {
  ensureRole([...RoleSets.canWriteRequirements], actor.role);
  requireNonBlank(input.statement, "statement", "Requirement statement is required.");
  const suppliedId = suppliedBusinessId(
    input.businessId,
    BUSINESS_ID_PATTERNS.requirement,
    "REQ###",
    "Requirement ID cannot be blank."
  );

  const db = txClient ?? prisma;
  const feature = await db.feature.findUnique({ where: { id: input.featureId } });
  if (!feature) throw new AppError(404, "REFERENCE_NOT_FOUND", "Feature not found.", "featureId");

  if (suppliedId) {
    const existing = await db.requirement.findUnique({ where: { businessId: suppliedId } });
    if (existing) throw new AppError(409, "ID_DUPLICATE", "Requirement ID already exists.", "businessId");
  }

  return runInTransaction(txClient, async (tx) => {
    const businessId =
      suppliedId ?? (await allocateBusinessId(tx, "requirement", requirementIdFormat(tx)));
    const created = await tx.requirement.create({
      data: {
        businessId,
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
  /* Same set as the create, not the admin set the other three levels use. An author who may
     write a requirement may correct one — the alternative is a QA Engineer who can commit a
     typo and then cannot fix it, which is not a permission model, it is a trap. Matches
     "Create or edit Draft test case and steps", which grants both halves together. */
  ensureRole([...RoleSets.canWriteRequirements], actor.role);
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
