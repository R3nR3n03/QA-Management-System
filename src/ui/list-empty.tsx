import Link from "next/link";
import { hrefWith, type ListSearchParams } from "./list-params";

/**
 * The empty body of a paged list.
 *
 * A list can render zero rows for two unrelated reasons, and saying the wrong one is
 * worse than saying nothing:
 *
 * 1. **Nothing matched.** The filters excluded everything. The caller owns this
 *    sentence, because only it knows which filters it offered.
 * 2. **The page is past the end.** `total` is positive but this offset holds no rows.
 *
 * Every list used to infer the reason from the filter parameters alone, which made the
 * second case report the first. `readPage` does not clamp (`list-params.ts:31`) and
 * `Pager` clamps for display only (`pager.tsx:54`), so `?page=2` on a list that has
 * since shrunk under one page reached the filter branch with no filter set — printing
 * `Nothing matches “”.` with empty quotes on the test-case and defect lists, and "No
 * execution matches the current filters" with none applied. The pager directly below
 * said "Showing 1–45 of 45" at the same time, so the card contradicted itself.
 *
 * This is reachable without touching a URL: hold page 2 of the review queue while
 * colleagues approve it down to one page.
 */
export function ListEmpty({
  total,
  pathname,
  params,
  pageKey = "page",
  noMatch
}: {
  /** Matching rows BEFORE paging. Positive here means the offset overshot. */
  total: number;
  pathname: string;
  params: ListSearchParams | undefined;
  pageKey?: string;
  /** What to say when the filters genuinely matched nothing. */
  noMatch: React.ReactNode;
}) {
  if (total > 0) {
    return (
      <div className="empty">
        <p>This page is past the end of the list.</p>
        {/* An out-of-range page is a dead end: the pager's Previous/Next are computed
            from the CLAMPED page, so they point back into the same empty view. This is
            the way out. */}
        <Link className="btn btn-secondary btn-sm" href={hrefWith(pathname, params, { [pageKey]: null })}>
          Go to the first page
        </Link>
      </div>
    );
  }

  return (
    <div className="empty">
      <p>{noMatch}</p>
    </div>
  );
}
