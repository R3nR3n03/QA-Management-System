import Link from "next/link";
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
 * ## A table, not a list of rows
 *
 * These were `.list-row`s: the ID and the state chip on one line, the title on the next, and
 * `high priority · major severity` on a third. Five homogeneous fields, and two of them
 * appended to each other as a sentence — so a Critical/Blocker case read exactly like a
 * Low/Trivial one, and nothing could be scanned down the page. Fifty of those rows ran a page
 * and a half deep, and every pixel of a wide screen went to empty margin beside three short
 * lines.
 *
 * That is precisely the failure that moved the check batch list off `.list-row`
 * (`DESIGN-SYSTEM.md`, Data table: "a tally appended to the timestamp… the column could not be
 * scanned"), and the fix is the same one: the words become `<th>`s and the values become cells
 * under them. Every column but `Title` hugs its content (`.tight`), so the title — the only
 * column that gains from room — takes all the slack a wide screen provides.
 *
 * The trailing `View` button went with the rows. In a three-line block it was the only thing
 * that looked clickable; in a table the ID and the title are the two leftmost columns, the row
 * carries a hover wash, and a sixth column holding a control that goes exactly where the title
 * already goes is chrome. It was `tabIndex={-1}` — deliberately outside the tab order, since 50
 * rows would otherwise be 100 stops — so no keyboard path is lost. Same call the batch list
 * makes.
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
  /**
   * Who wrote it. Only read when a caller passes `viewerUserId` — see that prop for why the
   * review queue needs it and the other two lists do not. Required rather than optional so the
   * marking cannot silently do nothing on a list whose rows happen not to carry it.
   */
  authorUserId: string;
};

/**
 * A field the row does not carry.
 *
 * Present, visibly empty, never absent: a blank cell in the middle of a table reads as a
 * rendering fault. The dash is `aria-hidden` with the word beside it in `.sr-only`, because a
 * screen reader announcing "em dash" down a column is worse than one saying "none" — the same
 * call `.num-none` makes about a zero.
 */
function Absent() {
  return (
    <span className="muted">
      <span aria-hidden>—</span>
      <span className="sr-only">None</span>
    </span>
  );
}

export function CaseTable({
  rows,
  total,
  page,
  pathname,
  params,
  emptyText,
  caption = "Test cases",
  showState = true,
  viewerUserId,
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
  /**
   * What the table is called in a screen reader's table list. The default speaks for
   * `/test-cases`; a screen that is already scoped should name its scope, on the same reasoning
   * `productEmptyText` records — an unnamed table and a table named for a list it is not are
   * both worse than one sentence of truth.
   */
  caption?: string;
  /**
   * Whether the lifecycle state earns a column.
   *
   * `false` for a list already scoped to ONE state — the review queue, where every row said
   * `In Review` and a column repeating the same word down the page is the noise `.week-bar` and
   * the batch list's chip bag both record. `/my-work/drafts` keeps it: it is scoped to two
   * states, so the column tells a reader which of them each row is in, which is the difference
   * between a case they can still edit and one they cannot.
   */
  showState?: boolean;
  /**
   * The signed-in user, when this list must say which rows are the viewer's OWN work.
   *
   * Set on the review queue and nowhere else. That screen's lede states the rule — an author
   * cannot approve their own case (`roles-workflows.md:26`) — and the list gave no way to tell
   * which rows it applied to, so a reviewer found out by opening one. Comparing an id the page
   * already holds costs no query.
   */
  viewerUserId?: string;
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
            noMatch={
              <p>
                {(() => {
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
              </p>
            }
          />
        ) : (
          /* COLUMN ORDER: what identifies the case, then what it is, then the three fields a
             reader narrows or triages by. `Title` sits second because it is the click target
             and the widest column — putting it last would leave the row's own name at the far
             edge of a screen that may be 1900px wide. */
          <div className="table-scroll">
            <table className="data-table">
              {/* Without a name this announces as an unnamed table in a screen reader's
                  table list. */}
              <caption className="sr-only">{caption}</caption>
              <thead>
                <tr>
                  <th scope="col" className="tight">
                    ID
                  </th>
                  <th scope="col">Title</th>
                  {showState ? (
                    <th scope="col" className="tight">
                      State
                    </th>
                  ) : null}
                  <th scope="col" className="tight">
                    Priority
                  </th>
                  <th scope="col" className="tight">
                    Severity
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    {/* A `<td>` and not a `<th scope="row">`: `.data-table th` is styled and
                        stickied for a COLUMN heading and would mangle a row header — the rule
                        the batch report already records. */}
                    {/* Two cells share this column: the ID people quote, and — on the review
                        queue only — the mark saying the row is the viewer's own. */}
                    <td className="tight">
                      <span className="bid">{row.businessId}</span>
                      {/* The rows this viewer wrote, marked where they are identified.
                          Neutral `.state` and never `--blocked`: the graded tones belong to
                          what policy grades, and "you wrote this" is a fact about authorship,
                          not an outcome — the same rule the role chip on `/account` follows.
                          Only a handful of rows carry it, which is what makes it the right
                          loudness: those are the ones a reviewer should pass over. */}
                      {viewerUserId !== undefined && row.authorUserId === viewerUserId ? (
                        <span className="state case-mine">Yours</span>
                      ) : null}
                    </td>
                    {/* The title is the click target, matching ExecutionList: it is the widest
                        thing in the row and the thing the reader is already looking at. */}
                    <td>
                      <Link className="row-link case-title" href={`/test-cases/${row.id}`}>
                        {row.title}
                      </Link>
                    </td>
                    {showState ? (
                      <td className="tight">
                        <TestCaseStateChip state={row.lifecycleState} />
                      </td>
                    ) : null}
                    {/* Words, not chips. Priority and severity are controlled values with no
                        tone of their own — `docs/business-rules-and-validation.md` grades
                        nothing by them — and a column of coloured pills would read as a verdict
                        on each case. The heading names the field; the cell is its value. */}
                    <td className="tight">{row.priority || <Absent />}</td>
                    <td className="tight">{row.severity || <Absent />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
