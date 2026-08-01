"use client";

import { useState, type ReactNode } from "react";
import { Pager } from "./pager";
import { PAGE_SIZE, clampPage, pageSlice } from "./paging";

/**
 * Pages an array of already-rendered row nodes. The rows stay SERVER-rendered — a
 * server component maps its records to elements (inline server-action forms and all)
 * and hands the array across the boundary; only the slicing lives on the client. That
 * is what lets admin/users, the catalogue sections and the import-runs list page
 * without converting their rows to client components.
 *
 * Static lists only: these rows have no client-side filter, so there is no
 * filter-change reset to coordinate — the pager clamps if the list shrinks across a
 * revalidation. Filterable client lists (CaseTable, ExecutionList, DefectList,
 * RowsTable) own their page state instead and reset it when their filters change.
 */
export function PagedList({
  items,
  pageSize = PAGE_SIZE,
  emptyText,
  label
}: {
  items: ReactNode[];
  pageSize?: number;
  emptyText?: string;
  label?: string;
}) {
  const [page, setPage] = useState(1);

  if (items.length === 0) {
    return emptyText ? (
      <div className="empty">
        <p>{emptyText}</p>
      </div>
    ) : null;
  }

  const current = clampPage(page, items.length, pageSize);

  return (
    <>
      {pageSlice(items, current, pageSize)}
      <Pager total={items.length} page={current} onPageChange={setPage} pageSize={pageSize} label={label} />
    </>
  );
}
