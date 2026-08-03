/**
 * Pure paging math for the shared list pagination idiom (DESIGN-SYSTEM.md § Components).
 * Presentation only: which rows exist is always the server's answer; paging changes
 * what is on screen, never what exists. Pages are 1-based and 50 rows deep — the same
 * size the import report canonized before the shared `Pager` existed.
 */

export const PAGE_SIZE = 50;

/** How many pages `total` rows occupy (at least 1, so an empty list still has a page). */
export function pageCount(total: number, pageSize: number = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/**
 * Clamps a 1-based page into the valid range for `total` rows. A filter can shrink
 * the list under the current page (page 3 of what is now 40 rows); clamping keeps the
 * pager consistent even before the consumer resets to page 1.
 */
export function clampPage(page: number, total: number, pageSize: number = PAGE_SIZE): number {
  if (!Number.isFinite(page)) return 1;
  return Math.min(Math.max(1, Math.floor(page)), pageCount(total, pageSize));
}

/** The rows of one 1-based page. */
export function pageSlice<T>(items: readonly T[], page: number, pageSize: number = PAGE_SIZE): T[] {
  const clamped = clampPage(page, items.length, pageSize);
  return items.slice((clamped - 1) * pageSize, clamped * pageSize);
}

/**
 * The row counts a viewer may choose between. Kept short on purpose: a free-text page
 * size is a way to pull the whole table through a paginated endpoint, and the server
 * clamps to `MAX_PAGE_SIZE` regardless (`src/lib/pagination.ts`).
 */
export const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

/** A rendered page number, or the elision between two runs of them. */
export type PageToken = number | "gap";

/**
 * The page numbers to render, elided in the middle: `1 … 8 9 10 11 12 … 21`.
 *
 * Prev/Next alone is fine over three pages and hostile over twenty-one — reaching the
 * end of a 1,002-row list meant twenty clicks. First and last are always present so
 * both ends stay one click away, with `span` pages either side of the current one.
 *
 * A gap of exactly one page renders as that page rather than an ellipsis: `1 2 3` is
 * both shorter and more useful than `1 … 3`.
 */
export function pageTokens(current: number, last: number, span = 2): PageToken[] {
  if (last <= 1) return [1];

  const wanted = new Set<number>([1, last]);
  for (let page = current - span; page <= current + span; page += 1) {
    if (page >= 1 && page <= last) wanted.add(page);
  }

  const tokens: PageToken[] = [];
  let previous = 0;
  for (const page of [...wanted].sort((a, b) => a - b)) {
    if (previous > 0) {
      if (page - previous === 2) tokens.push(previous + 1);
      else if (page - previous > 2) tokens.push("gap");
    }
    tokens.push(page);
    previous = page;
  }
  return tokens;
}

/** `"Showing 1–50 of 132"` — the pager's status line. */
export function pageRangeLabel(total: number, page: number, pageSize: number = PAGE_SIZE): string {
  if (total === 0) return "Showing 0 of 0";
  const clamped = clampPage(page, total, pageSize);
  const first = (clamped - 1) * pageSize + 1;
  const last = Math.min(clamped * pageSize, total);
  return `Showing ${first}–${last} of ${total}`;
}
