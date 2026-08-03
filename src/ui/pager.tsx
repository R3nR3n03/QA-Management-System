import Link from "next/link";
import { PAGE_SIZE, clampPage, pageCount, pageRangeLabel } from "./paging";
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
  label?: string;
}) {
  if (total <= pageSize) return null;

  const current = clampPage(page, total, pageSize);
  const last = pageCount(total, pageSize);
  // Page 1 drops the key entirely rather than writing `?page=1`.
  const href = (target: number) =>
    hrefWith(pathname, params, { [pageKey]: target <= 1 ? null : target });

  return (
    <nav className="row" aria-label={`Pages of the ${label}`} style={{ padding: "var(--sp-3) var(--sp-4)" }}>
      <span className="muted row-main">{pageRangeLabel(total, current, pageSize)}</span>
      {current === 1 ? (
        <span className="btn btn-ghost btn-sm is-disabled" aria-disabled="true">
          Previous
        </span>
      ) : (
        <Link className="btn btn-ghost btn-sm" href={href(current - 1)} scroll={false}>
          Previous
        </Link>
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
    </nav>
  );
}
