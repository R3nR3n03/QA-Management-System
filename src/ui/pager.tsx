"use client";

import { PAGE_SIZE, clampPage, pageCount, pageRangeLabel } from "./paging";

/**
 * The canonical list pager (DESIGN-SYSTEM.md § Components): "Showing X–Y of N" plus
 * Prev/Next as real, keyboard-operable buttons. Renders nothing until the list
 * exceeds one page — small lists stay uncluttered, the same way FilterToolbar stays
 * hidden under 5 rows. Client-side only; paging is presentation, the server decides
 * what exists.
 *
 * Consumers own the page state so they can reset it when their filter or sort
 * changes; this control just clamps and reports. The inline padding matches the row
 * inset it usually sits under inside a `.card-flush` — defined once here, not
 * re-declared per page.
 */
export function Pager({
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
