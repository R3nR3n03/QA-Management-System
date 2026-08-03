import Link from "next/link";
import { PAGE_SIZE, PAGE_SIZE_OPTIONS, clampPage, pageCount, pageRangeLabel, pageTokens } from "./paging";
import { hrefWith, type ListSearchParams } from "./list-params";

/**
 * The canonical list pager (DESIGN-SYSTEM.md § Components): "Showing X–Y of N" plus
 * Prev/Next. Renders nothing until the list exceeds one page — small lists stay
 * uncluttered, the same way FilterToolbar stays hidden under 5 rows.
 *
 * ## Why this is a server component built from links
 *
 * It used to be a client component calling `onPageChange`, which required its consumer
 * to hold every row in memory in order to slice locally. Now `total` is the server's
 * `COUNT` and the rows on screen are the only ones fetched, so turning a page is a
 * navigation: real `<a href>`s, middle-clickable and bookmarkable, working before and
 * without hydration. `hrefWith` carries the rest of the query string along, so paging
 * one list on a screen that shows four does not disturb the other three.
 *
 * `page` is clamped for DISPLAY only. A URL asking for page 900 of a 3-page list gets
 * an empty result set from the query and a pager that honestly reports the last page.
 */
export function Pager({
  total,
  page,
  pathname,
  params,
  pageKey = "page",
  pageSize = PAGE_SIZE,
  sizeKey = "size",
  sizeOptions,
  label = "list"
}: {
  /** Row count BEFORE paging and AFTER filtering — the server's count, never `rows.length`. */
  total: number;
  page: number;
  pathname: string;
  params: ListSearchParams | undefined;
  /** Query-string key this pager owns. Distinct per list on multi-list screens. */
  pageKey?: string;
  pageSize?: number;
  /** Query-string key for rows-per-page. Only used when `sizeOptions` is given. */
  sizeKey?: string;
  /**
   * Offer a rows-per-page control. Omitted on screens showing several lists at once,
   * where one control could not say which list it governs.
   */
  sizeOptions?: readonly number[];
  label?: string;
}) {
  const last = pageCount(total, pageSize);
  // Nothing to page and no size worth changing: stay out of the way entirely.
  if (total <= pageSize && !sizeOptions) return null;

  const current = clampPage(page, total, pageSize);
  // Page 1 drops the key entirely rather than writing `?page=1`.
  const href = (target: number) =>
    hrefWith(pathname, params, { [pageKey]: target <= 1 ? null : target });
  // Changing the page size changes what page 1 even means, so it returns to the start
  // rather than stranding the viewer at an offset that no longer lines up.
  const sizeHref = (size: number) =>
    hrefWith(pathname, params, { [sizeKey]: size === PAGE_SIZE ? null : size, [pageKey]: null });

  return (
    <nav className="row" aria-label={`Pages of the ${label}`} style={{ padding: "var(--sp-3) var(--sp-4)" }}>
      <span className="muted row-main">{pageRangeLabel(total, current, pageSize)}</span>

      {sizeOptions ? (
        <span className="cluster" role="group" aria-label={`Rows per page of the ${label}`}>
          <span className="muted">Rows</span>
          {sizeOptions.map((size) =>
            size === pageSize ? (
              <span key={size} className="btn btn-sm" aria-current="true">
                {size}
              </span>
            ) : (
              <Link key={size} className="btn btn-secondary btn-sm" href={sizeHref(size)} scroll={false}>
                {size}
              </Link>
            )
          )}
        </span>
      ) : null}

      {last > 1 ? (
        <>
          {current === 1 ? (
            <span className="btn btn-ghost btn-sm is-disabled" aria-disabled="true">
              Previous
            </span>
          ) : (
            <Link className="btn btn-ghost btn-sm" href={href(current - 1)} scroll={false}>
              Previous
            </Link>
          )}

          {/* Numbered jumps, elided in the middle. Without these, the far end of a
              21-page list was twenty Next clicks away. */}
          {pageTokens(current, last).map((token, index) =>
            token === "gap" ? (
              <span key={`gap-${index}`} className="muted" aria-hidden>
                &hellip;
              </span>
            ) : token === current ? (
              <span key={token} className="btn btn-sm" aria-current="page">
                {token}
              </span>
            ) : (
              <Link
                key={token}
                className="btn btn-ghost btn-sm"
                href={href(token)}
                aria-label={`Page ${token}`}
                scroll={false}
              >
                {token}
              </Link>
            )
          )}

          {current === last ? (
            <span className="btn btn-ghost btn-sm is-disabled" aria-disabled="true">
              Next
            </span>
          ) : (
            <Link className="btn btn-ghost btn-sm" href={href(current + 1)} scroll={false}>
              Next
            </Link>
          )}
        </>
      ) : null}
    </nav>
  );
}

export { PAGE_SIZE_OPTIONS };
