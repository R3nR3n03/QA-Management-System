/**
 * Server-side pagination for collection reads.
 *
 * `docs/api-and-security.md:5` requires it — "Collection endpoints support server-side
 * pagination, filtering, and sorting only for documented fields" — and nothing
 * implemented it: every list service read its whole table and every list screen shipped
 * the whole table to the browser to slice there.
 *
 * ## Why `page` is optional
 *
 * Omitting `page` means "every row", and that is what the `/api/v1` collection routes
 * still do. The docs establish that pagination is SUPPORTED, not that it is mandatory,
 * and they establish no paginated response envelope at all — `docs/testing-and-acceptance.md`
 * pins no collection shape either. Changing what those routes already return (a bare
 * JSON array) would be inventing policy, so the routes opt in via `?page=` and default
 * to the shape they have always returned. The web screens always pass a page.
 *
 * An envelope for the paginated API response is a genuine gap and wants QA Lead
 * confirmation before `/api/v1` starts paginating by default.
 *
 * Pure: no Prisma import, so this is unit-testable without a database.
 */

/** The shipped page depth, matching the list idiom in DESIGN-SYSTEM.md § Components. */
export const DEFAULT_PAGE_SIZE = 50;

/**
 * A caller-supplied `pageSize` is clamped to this. An unbounded `take` from a query
 * string is how a "paginated" endpoint gets used to pull the whole table in one request.
 */
export const MAX_PAGE_SIZE = 200;

export type PageRequest = {
  /** 1-based. Undefined means every row: no `skip`, no `take`. */
  page?: number;
  pageSize?: number;
};

/** What every list service returns. `total` is the count BEFORE paging, after filtering. */
export type Paged<T> = {
  rows: T[];
  total: number;
  /** The page actually served — 1 when the caller asked for everything. */
  page: number;
  pageSize: number;
};

export function resolvePageSize(pageSize: number | undefined): number {
  if (pageSize === undefined || !Number.isFinite(pageSize)) return DEFAULT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(pageSize)));
}

export function resolvePage(page: number | undefined): number {
  if (page === undefined || !Number.isFinite(page)) return 1;
  return Math.max(1, Math.floor(page));
}

/**
 * Prisma `skip`/`take` for a request — an EMPTY object when the caller asked for every
 * row, so it spreads into a query without contributing either key.
 */
export function pageArgs(request: PageRequest): { skip: number; take: number } | Record<string, never> {
  if (request.page === undefined) return {};
  const pageSize = resolvePageSize(request.pageSize);
  return { skip: (resolvePage(request.page) - 1) * pageSize, take: pageSize };
}

/**
 * The body every list service shares: fetch the page and the matching count.
 *
 * When the caller wants everything there is no second query — `rows.length` IS the
 * total, and a `COUNT(*)` would be a wasted round trip. When they want a page, the
 * count runs CONCURRENTLY with the page fetch rather than after it; both use the same
 * `where`, so the total always describes the filtered set the page came from.
 */
export async function runPaged<T>(
  request: PageRequest,
  find: (args: { skip?: number; take?: number }) => Promise<T[]>,
  count: () => Promise<number>
): Promise<Paged<T>> {
  if (request.page === undefined) {
    const rows = await find({});
    return paged(rows, rows.length, request);
  }
  const [rows, total] = await Promise.all([find(pageArgs(request)), count()]);
  return paged(rows, total, request);
}

/** Wraps a service's rows and count into the shared return shape. */
export function paged<T>(rows: T[], total: number, request: PageRequest): Paged<T> {
  return {
    rows,
    total,
    page: request.page === undefined ? 1 : resolvePage(request.page),
    pageSize: request.page === undefined ? total : resolvePageSize(request.pageSize)
  };
}

/**
 * A case-insensitive `contains` filter for one search box across several columns.
 * Returns `undefined` for a blank needle so it spreads away rather than matching
 * everything with an empty string.
 *
 * NOTE: this compiles to `ILIKE '%needle%'`, which no btree index can serve — the
 * `@@index` set added for the sort and filter columns does not help here, and a
 * large table will sequential-scan on search. Trigram (`pg_trgm` + GIN) indexes are
 * the fix if search ever gets slow; that needs `CREATE EXTENSION`, which is a
 * deployment decision rather than a schema one.
 */
export function containsAny<T extends string>(
  needle: string,
  fields: readonly T[]
): { OR: Array<Record<T, { contains: string; mode: "insensitive" }>> } | undefined {
  const trimmed = needle.trim();
  if (trimmed === "") return undefined;
  return {
    OR: fields.map(
      (field) =>
        ({ [field]: { contains: trimmed, mode: "insensitive" } }) as Record<
          T,
          { contains: string; mode: "insensitive" }
        >
    )
  };
}
