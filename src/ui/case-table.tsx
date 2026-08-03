import Link from "next/link";
import type { TestCaseLifecycleState } from "@prisma/client";
import { TestCaseStateChip } from "./chips";
import { readParam, type ListSearchParams } from "./list-params";
import { Pager } from "./pager";
import { PAGE_SIZE, PAGE_SIZE_OPTIONS } from "./paging";
import { UrlFilterToolbar } from "./toolbar";

/**
 * The one way a list of test cases renders, so `/test-cases`, `/my-work/drafts` and
 * `/review` stay visually identical.
 *
 * ## Server component
 *
 * It used to be `"use client"`, holding every row the server had and slicing locally.
 * Now `rows` is exactly the page the database returned and `total` is its `COUNT`, so
 * this renders on the server: the filter needle and page number arrive in the URL, not
 * in `useState`. Two things fall out of that beyond the payload saving — a filtered page
 * is a shareable link, and `./chips` (which reads its labels off the Prisma enums) no
 * longer drags `@prisma/client` into the browser bundle.
 *
 * Filtering and paging remain presentation: which rows EXIST is still the server's
 * answer, and what a viewer may do with one is the domain's.
 */
export type CaseRow = {
  id: string;
  businessId: string;
  title: string;
  lifecycleState: TestCaseLifecycleState;
  priority: string;
  severity: string;
};

export function CaseTable({
  rows,
  total,
  page,
  pathname,
  params,
  emptyText,
  pageSize = PAGE_SIZE,
  queryKey = "q",
  pageKey = "page"
}: {
  /** One page of rows, already fetched with `skip`/`take`. */
  rows: CaseRow[];
  /** Matching row count before paging — the server's `COUNT`, not `rows.length`. */
  total: number;
  page: number;
  pathname: string;
  params: ListSearchParams | undefined;
  emptyText: string;
  pageSize?: number;
  queryKey?: string;
  pageKey?: string;
}) {
  const query = readParam(params, queryKey);
  // The toolbar must survive a filter that matches few rows, or there is no way left to
  // clear it — so an ACTIVE filter keeps it on screen regardless of the count.
  const showFilter = query !== "" || total > 5;

  if (total === 0 && query === "") {
    return (
      <div className="card empty">
        <p>{emptyText}</p>
      </div>
    );
  }

  return (
    <>
      {showFilter ? (
        <UrlFilterToolbar
          placeholder="Filter by ID, title, or state…"
          label="Filter test cases"
          paramKey={queryKey}
          pageKey={pageKey}
        />
      ) : null}

      <div className="card card-flush">
        {rows.length === 0 ? (
          <div className="empty">
            <p>Nothing matches &ldquo;{query}&rdquo;.</p>
          </div>
        ) : (
          rows.map((row) => (
            <div key={row.id} className="list-row">
              <div className="row-main">
                <div className="cluster">
                  <span className="bid">{row.businessId}</span>
                  <TestCaseStateChip state={row.lifecycleState} />
                </div>
                <div className="row-title">{row.title}</div>
                <div className="muted">
                  {row.priority || "no"} priority · {row.severity || "no"} severity
                </div>
              </div>
              <Link href={`/test-cases/${row.id}`} style={{ fontSize: 14 }}>
                View
              </Link>
            </div>
          ))
        )}
        <Pager
          total={total}
          page={page}
          pathname={pathname}
          params={params}
          pageKey={pageKey}
          pageSize={pageSize}
          sizeOptions={PAGE_SIZE_OPTIONS}
          label="test cases"
        />
      </div>
    </>
  );
}
