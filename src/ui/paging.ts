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

/** `"Showing 1–50 of 132"` — the pager's status line. */
export function pageRangeLabel(total: number, page: number, pageSize: number = PAGE_SIZE): string {
  if (total === 0) return "Showing 0 of 0";
  const clamped = clampPage(page, total, pageSize);
  const first = (clamped - 1) * pageSize + 1;
  const last = Math.min(clamped * pageSize, total);
  return `Showing ${first}–${last} of ${total}`;
}
