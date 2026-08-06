import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { TestCaseLifecycleState } from "@prisma/client";
import { TestCaseStateChip } from "./chips";
import { ListEmpty } from "./list-empty";
import { readParam, type ListSearchParams } from "./list-params";
import { Pager } from "./pager";
import { PAGE_SIZE, PAGE_SIZE_OPTIONS } from "./paging";
import { UrlFilterToolbar, UrlSelectFilter } from "./toolbar";

/** A product offered as a filter option. */
export type ProductOption = { id: string; businessId: string; name: string };

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
  pageKey = "page",
  products,
  productKey = "product",
  productEmptyText = "No test case belongs to this product.",
  features,
  featureKey = "feature",
  featureEmptyText = "No test case belongs to this feature."
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
  /** Omit to leave the product filter off this screen entirely. */
  products?: ProductOption[];
  productKey?: string;
  /**
   * What to say when the product filter is the only thing that emptied the list. The
   * default speaks for `/test-cases`, which shows every case; a screen that is already
   * scoped must say so, or it claims something false. `/review` showing "no test case
   * belongs to this product" for a product with two hundred Approved cases and nothing
   * in review is a screen arguing with the one next to it.
   */
  productEmptyText?: string;
  /** Omit to leave the feature filter off this screen entirely. Independent of the
      product filter — same convention as the picker's product/requirement facets, but
      this screen is server-paged, not local state, so the two selects do not rescope
      each other; picking a feature from a different product than the one selected
      just empties the list, same as any other filter combination that matches nothing. */
  features?: ProductOption[];
  featureKey?: string;
  /** Same reasoning as `productEmptyText`, one level narrower. */
  featureEmptyText?: string;
}) {
  const query = readParam(params, queryKey);
  const product = readParam(params, productKey);
  const feature = readParam(params, featureKey);
  // A filter must survive matching few rows, or there is no way left to clear it — so an
  // ACTIVE filter of either kind keeps the controls on screen regardless of the count.
  const filtered = query !== "" || product !== "" || feature !== "";
  const showNeedle = filtered || total > 5;
  /*
   * The product dropdown is offered whenever there are products at all, matching
   * `ExecutionList`. It used to require TWO — the argument being that with one product
   * every row belongs to it, so the control cannot change the list, and a filter that
   * does nothing teaches people to distrust the ones that do.
   *
   * That reads well and behaves badly: a catalogue grows one product at a time, and a
   * filter that appears by itself once someone adds a second is a filter nobody knows
   * to look for. It also made the control invisible on every screen of a single-product
   * deployment, which looks like the feature was never built. Being consistently there
   * is worth more than being hidden while it is redundant.
   *
   * It is NOT tied to `showNeedle`: the row count decides whether a needle earns its
   * place, and the catalogue decides whether the product filter does.
   */
  const showProducts = products !== undefined && products.length > 0;
  const showFeatures = features !== undefined && features.length > 0;

  if (total === 0 && !filtered) {
    return (
      <div className="card empty">
        <p>{emptyText}</p>
      </div>
    );
  }

  return (
    <>
      {showNeedle || showProducts || showFeatures ? (
        <div className="row" style={{ marginBottom: "var(--sp-3)" }}>
          {showNeedle ? (
            <UrlFilterToolbar
              placeholder="Filter by ID, title, or state…"
              label="Filter test cases"
              paramKey={queryKey}
              pageKey={pageKey}
            />
          ) : null}
          {showProducts ? (
            <UrlSelectFilter
              options={products.map((row) => ({
                value: row.id,
                label: `${row.businessId} · ${row.name}`
              }))}
              label="Filter by product"
              allLabel="All products"
              paramKey={productKey}
              pageKey={pageKey}
            />
          ) : null}
          {showFeatures ? (
            <UrlSelectFilter
              options={features.map((row) => ({
                value: row.id,
                label: `${row.businessId} · ${row.name}`
              }))}
              label="Filter by feature"
              allLabel="All features"
              paramKey={featureKey}
              pageKey={pageKey}
            />
          ) : null}
        </div>
      ) : null}

      <div className="card card-flush">
        {rows.length === 0 ? (
          // Three filters can each empty the list, so the message has to name the one
          // (or two) that did it — "nothing matches" with an empty needle reads as a bug.
          // ListEmpty takes the third case (a page past the end) off this branch entirely.
          <ListEmpty
            total={total}
            pathname={pathname}
            params={params}
            pageKey={pageKey}
            noMatch={(() => {
              const scopeNames = [product !== "" ? "this product" : null, feature !== "" ? "this feature" : null].filter(
                (name): name is string => name !== null
              );
              if (query !== "") {
                const scopeSuffix = scopeNames.length > 0 ? ` in ${scopeNames.join(" and ")}` : "";
                return `Nothing matches “${query}”${scopeSuffix}.`;
              }
              if (product !== "" && feature !== "") return `No test case belongs to ${scopeNames.join(" and ")}.`;
              return feature !== "" ? featureEmptyText : productEmptyText;
            })()}
          />
        ) : (
          <ul className="row-list">
            {rows.map((row) => (
              <li key={row.id} className="list-row">
                <div className="row-main">
                  <div className="cluster">
                    <span className="bid">{row.businessId}</span>
                    <TestCaseStateChip state={row.lifecycleState} />
                  </div>
                  {/* The title is the click target, matching ExecutionList: it is the
                      widest thing in the row and the thing the reader is already looking
                      at. Before this, cases and defects were the only lists where
                      clicking the title did nothing. */}
                  <div className="row-title">
                    <Link className="row-link" href={`/test-cases/${row.id}`}>
                      {row.title}
                    </Link>
                  </div>
                  <div className="muted">
                    {row.priority || "no"} priority · {row.severity || "no"} severity
                  </div>
                </div>
                {/* Same destination as the title, so it leaves the tab order: 50 rows
                    would otherwise be 100 tab stops to reach 50 places. The label names
                    the record, or a screen reader's link list is 50 identical "View"s. */}
                <Link
                  className="btn btn-secondary btn-sm"
                  href={`/test-cases/${row.id}`}
                  aria-label={`View ${row.businessId}`}
                  tabIndex={-1}
                >
                  View
                  <ChevronRight size={14} aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
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
