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
 *
 * ## The caller owns the ELEMENT, not just the sentence
 *
 * `noMatch` used to be wrapped here in a `<p>`. That is fine for the four lists that pass a
 * phrase and invalid for the catalogue, which passes a rich empty state — a `<div>` with an
 * `<h3>` and a `<p>` of its own. `<h3>` cannot descend from `<p>`, so the browser closed the
 * paragraph early, the client tree and the server tree disagreed, and the catalogue threw a
 * hydration error on any feature with no requirements.
 *
 * So the wrapper is gone and every caller passes a complete element. That also fails in the
 * safe direction: a future caller who passes a bare string gets an unstyled line — visible
 * immediately, and not a broken render.
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
  /**
   * What to say when the filters genuinely matched nothing — as a complete element, not a
   * bare phrase. A one-line message is `<p>…</p>`; `.empty p` styles it. See the note above.
   */
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

  return <div className="empty">{noMatch}</div>;
}
