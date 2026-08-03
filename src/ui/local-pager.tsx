"use client";

import { PAGE_SIZE, clampPage, pageCount, pageRangeLabel } from "./paging";

/**
 * The pager for a list that is genuinely in memory already, where paging cannot be a
 * navigation because there is nothing to re-fetch.
 *
 * There is exactly one of those: the import-run report at `/admin/imports/[id]`, whose
 * rows come out of a single `ImportRun.reportJson` column. One record is one read no
 * matter how it is displayed, so slicing it on the client costs nothing — unlike the
 * table-backed lists, which now page in the database via the server-rendered `Pager`.
 *
 * Reach for that one by default. This exists for the in-memory case, not as an
 * alternative to it.
 */
export function LocalPager({
  total,
  page,
  onPageChange,
  pageSize = PAGE_SIZE,
  label = "list"
}: {
  total: number;
  page: number;
  onPageChange: (page: number) => void;
  pageSize?: number;
  label?: string;
}) {
  if (total <= pageSize) return null;

  const current = clampPage(page, total, pageSize);
  const last = pageCount(total, pageSize);

  return (
    <nav className="row" aria-label={`Pages of the ${label}`} style={{ padding: "var(--sp-3) var(--sp-4)" }}>
      <span className="muted row-main">{pageRangeLabel(total, current, pageSize)}</span>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => onPageChange(current - 1)}
        disabled={current === 1}
      >
        Previous
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => onPageChange(current + 1)}
        disabled={current === last}
      >
        Next
      </button>
    </nav>
  );
}
