import Link from "next/link";
import { CalendarClock, ChevronRight, CircleCheck, CirclePlay, ClipboardList } from "lucide-react";
import { ExecutionLifecycleState, type ExecutionOutcome } from "@prisma/client";
import { ExecutionStateChip, OutcomeChip } from "./chips";
import { formatUtcMinute } from "./format";
import { ListEmpty } from "./list-empty";
import { hrefWith, readParam, type ListSearchParams } from "./list-params";
import { Pager } from "./pager";
import { PAGE_SIZE, PAGE_SIZE_OPTIONS } from "./paging";
import { RefreshButton } from "./refresh-button";
import { UrlSelectFilter } from "./toolbar";
import type { ProductOption } from "./case-table";

/**
 * The My work queue: the rows a tester came to the screen to act on, and the recap of
 * what they just finished.
 *
 * Presentation only. Which runs exist and which of them are the viewer's is the
 * server's answer (`listExecutionsForTester` scopes by `testerId` in the `where`), and
 * what may be done with one stays the domain's — every control here is a link to the
 * run's own screen, where the transition endpoints do the gating.
 *
 * Split out of the page so it can be rendered in a test without a database, the same
 * arrangement `record-list.tsx` uses for the executions and defects lists.
 *
 * A server component: the state chips read their labels off the Prisma enums, and the
 * tabs are links carrying `aria-current` rather than buttons over `useState` — the
 * chosen tab is a PLACE, so it is linkable, middle-clickable, and correct before
 * hydration. The one client island is the caller's filter field.
 */

export type WorkRowData = {
  id: string;
  businessId: string;
  state: ExecutionLifecycleState;
  /** Business IDs of every covered case, in coverage order. */
  caseBusinessIds: string[];
  /** The first covered case's title. */
  caseTitle: string;
  /** The first covered case's priority; shown only for a single-case run. */
  priority: string;
  plannedAt: Date;
  startedAt: Date | null;
};

export type FinalizedRowData = {
  id: string;
  businessId: string;
  /** The run's derived worst outcome. `null` should not occur on a finalized run. */
  result: ExecutionOutcome | null;
  caseBusinessIds: string[];
  caseTitle: string;
  finalizedAt: Date | null;
};

/** The open-queue tabs. "Blocked" is a case OUTCOME, never a run state — see the enum. */
const WORK_TABS = [
  { value: "ALL", label: "All runs" },
  { value: ExecutionLifecycleState.PLANNED, label: "Planned" },
  { value: ExecutionLifecycleState.IN_PROGRESS, label: "In Progress" }
] as const;

/** The queue's slices: one open state, or both. Never a state the queue does not show. */
export type WorkTab = "ALL" | Extract<ExecutionLifecycleState, "PLANNED" | "IN_PROGRESS">;

/** The one tab value a URL may carry, or `ALL` for both open states. */
export function readWorkTab(params: ListSearchParams | undefined, key = "state"): WorkTab {
  const raw = readParam(params, key);
  if (raw === ExecutionLifecycleState.PLANNED) return ExecutionLifecycleState.PLANNED;
  if (raw === ExecutionLifecycleState.IN_PROGRESS) return ExecutionLifecycleState.IN_PROGRESS;
  // Anything else — including a hand-typed `FINALIZED`, which this queue does not show
  // — falls back to the whole open queue rather than to an empty screen.
  return "ALL";
}

/**
 * The run's most recent event, named.
 *
 * A queue row printing every stamp would be mostly noise; the run's own stepper carries
 * the history. The verb travels with the date because the same slot means a different
 * event per row, and a bare timestamp would leave the reader guessing which.
 */
function lastEvent(row: WorkRowData): { verb: string; at: Date } {
  return row.startedAt ? { verb: "Started", at: row.startedAt } : { verb: "Planned", at: row.plannedAt };
}

/** Which scope filter is narrowing the queue, for a sentence that has to name it. */
function scopeWord(product: string, feature: string): string {
  if (product !== "" && feature !== "") return "product and feature";
  return product !== "" ? "product" : "feature";
}

/** The tone marker beside a row. Colour repeats the chip, never replaces it. */
function StateMark({ state }: { state: ExecutionLifecycleState }) {
  const started = state === ExecutionLifecycleState.IN_PROGRESS;
  return (
    <span className="work-mark" data-tone={started ? "progress" : "planned"} aria-hidden>
      {started ? <CirclePlay size={18} /> : <ClipboardList size={18} />}
    </span>
  );
}

export function WorkQueue({
  rows,
  total,
  counts,
  page,
  pathname,
  params,
  pageSize = PAGE_SIZE,
  pageKey = "page",
  stateKey = "state",
  queryKey = "q",
  products,
  productKey = "product",
  features,
  featureKey = "feature"
}: {
  rows: WorkRowData[];
  total: number;
  /** Per-tab tallies under the SAME filters as `rows`, so a tab cannot over-promise. */
  counts: { open: number; planned: number; inProgress: number };
  page: number;
  pathname: string;
  params: ListSearchParams | undefined;
  pageSize?: number;
  pageKey?: string;
  stateKey?: string;
  queryKey?: string;
  /** Omit to leave the product filter off the bar entirely. */
  products?: ProductOption[];
  productKey?: string;
  /** Omit to leave the feature filter off the bar entirely. */
  features?: ProductOption[];
  featureKey?: string;
}) {
  const tab = readWorkTab(params, stateKey);
  const query = readParam(params, queryKey);
  const product = readParam(params, productKey);
  const feature = readParam(params, featureKey);
  const scoped = product !== "" || feature !== "";
  const countFor = (value: (typeof WORK_TABS)[number]["value"]) =>
    value === ExecutionLifecycleState.PLANNED
      ? counts.planned
      : value === ExecutionLifecycleState.IN_PROGRESS
        ? counts.inProgress
        : counts.open;

  return (
    <div className="card card-flush work-card">
      <div className="work-bar">
        {/* Three mutually exclusive views over one queue, so a segmented strip rather
            than three buttons — the same treatment the executions list uses. Each tab
            carries its own tally so the viewer can see an empty tab is empty before
            spending a navigation on it. */}
        <div className="seg" role="group" aria-label="Filter your runs by lifecycle state">
          {WORK_TABS.map((option) => (
            <Link
              key={option.value}
              // Switching tabs returns to page 1: staying on page 3 of a now-shorter
              // list would land on nothing.
              href={hrefWith(pathname, params, {
                [stateKey]: option.value === "ALL" ? null : option.value,
                [pageKey]: null
              })}
              aria-current={option.value === tab ? "true" : undefined}
              scroll={false}
            >
              {option.label}
              <span className="seg-count">{countFor(option.value)}</span>
            </Link>
          ))}
        </div>
        {/* Product and feature as dropdowns rather than more segments: lifecycle states
            are a closed set of three, while the catalogue has no ceiling — a chip per
            product would wrap into a wall the first time a real catalogue arrives. Same
            treatment as the executions and defects lists. */}
        {products && products.length > 0 ? (
          <UrlSelectFilter
            options={products.map((row) => ({
              value: row.id,
              label: `${row.businessId} · ${row.name}`
            }))}
            label="Filter your runs by product"
            allLabel="All products"
            paramKey={productKey}
            pageKey={pageKey}
          />
        ) : null}
        {features && features.length > 0 ? (
          <UrlSelectFilter
            options={features.map((row) => ({
              value: row.id,
              label: `${row.businessId} · ${row.name}`
            }))}
            label="Filter your runs by feature"
            allLabel="All features"
            paramKey={featureKey}
            pageKey={pageKey}
          />
        ) : null}
        <span className="work-bar-end">
          <span className="muted work-bar-count">
            {total} run{total === 1 ? "" : "s"}
          </span>
          {/* A queue is a shared surface — someone else can assign or finalize a run
              while this tab sits open. Beside the tally, because the tally is the number
              the refresh is there to bring up to date. */}
          <RefreshButton label="Refresh your work queue" />
        </span>
      </div>

      {rows.length === 0 ? (
        <ListEmpty
          total={total}
          pathname={pathname}
          params={params}
          pageKey={pageKey}
          // Name the filter that emptied the list. "Nothing here" with a needle still in
          // the field reads as a bug, and "nothing assigned" would be a lie when the
          // Planned tab is simply the wrong tab to be looking at.
          noMatch={
            query !== "" ? (
              <>
                No run of yours matches &ldquo;{query}&rdquo;
                {scoped ? ` in this ${scopeWord(product, feature)}` : ""}.
              </>
            ) : scoped ? (
              // The scope is the filter a reader is least likely to be looking at — the
              // tab it emptied is on screen showing a zero, the dropdown is one line of
              // small text — so it gets named.
              `No run of yours covers this ${scopeWord(product, feature)}.`
            ) : tab === ExecutionLifecycleState.PLANNED ? (
              "Nothing planned is waiting on you."
            ) : tab === ExecutionLifecycleState.IN_PROGRESS ? (
              "You have no run in progress."
            ) : (
              <>
                Nothing is waiting on you right now.{" "}
                <Link href="/executions">Browse all executions</Link>
              </>
            )
          }
        />
      ) : (
        <ul className="row-list">
          {rows.map((row) => {
            const event = lastEvent(row);
            const started = row.state === ExecutionLifecycleState.IN_PROGRESS;
            return (
              <li key={row.id} className="list-row work-row">
                <StateMark state={row.state} />
                <div className="row-main">
                  <div className="cluster">
                    <span className="bid">{row.businessId}</span>
                    <ExecutionStateChip state={row.state} />
                    {row.caseBusinessIds.length > 1 ? (
                      <span className="state state-accent">{row.caseBusinessIds.length} cases</span>
                    ) : null}
                  </div>
                  {/* The title is the click target as well as the trailing button: it is
                      the widest thing in the row and the thing already being read. Not a
                      stretched overlay — that would make the business ID unselectable,
                      and these are IDs people copy into a ticket. */}
                  <div className="row-title">
                    <Link className="row-link" href={`/executions/${row.id}`}>
                      {row.caseTitle}
                    </Link>
                  </div>
                  <div className="muted">
                    <span className="bid">{row.caseBusinessIds[0]}</span>
                    {row.caseBusinessIds.length > 1
                      ? ` +${row.caseBusinessIds.length - 1} more`
                      : ` · ${row.priority || "no"} priority`}
                  </div>
                </div>
                <span className="muted work-when">
                  <CalendarClock size={13} aria-hidden />
                  {event.verb}{" "}
                  <time dateTime={event.at.toISOString()}>{formatUtcMinute(event.at)}</time>
                </span>
                {/* The verb is the state's next move, so the row says what the click
                    does. Same destination as the title, so it leaves the tab order:
                    50 rows would otherwise be 100 stops to reach 50 places. */}
                <Link
                  className="btn work-cta"
                  href={`/executions/${row.id}`}
                  aria-label={`${started ? "Continue" : "Start"} ${row.businessId}`}
                  tabIndex={-1}
                >
                  {started ? "Continue" : "Start"}
                  <ChevronRight size={14} aria-hidden />
                </Link>
              </li>
            );
          })}
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
        label="work queue"
      />
    </div>
  );
}

/**
 * What the viewer finished, most recent first.
 *
 * Capped rather than paged: this is a recap under the queue, not a second list to work
 * through — the executions screen is where all of them live. The cap is stated in the
 * footer whenever it hides anything, so the section never quietly under-reports.
 */
export function FinalizedRecap({
  rows,
  total,
  href = "/executions"
}: {
  rows: FinalizedRowData[];
  /** Finalized runs matching the current filters, before the cap. */
  total: number;
  href?: string;
}) {
  if (rows.length === 0) return null;

  return (
    <section className="work-done">
      <div className="page-head work-done-head">
        <span className="work-mark" data-tone="done" aria-hidden>
          <CircleCheck size={18} />
        </span>
        <div className="page-head-text">
          <h2>Recently finalized</h2>
          <p className="muted">
            Finalized runs are immutable. A rerun creates a new execution covering only the
            failed or blocked case(s).
          </p>
        </div>
        <Link className="btn btn-secondary btn-sm" href={href}>
          View all
          <ChevronRight size={14} aria-hidden />
        </Link>
      </div>
      <div className="card card-flush">
        <ul className="row-list">
          {rows.map((row) => (
            // The stripe is keyed to the outcome the chip already names, so a scan down
            // the edge and a read of the chip say the same thing.
            <li key={row.id} className="list-row work-row" data-outcome={row.result ?? undefined}>
              <div className="row-main">
                <div className="cluster">
                  <span className="bid">{row.businessId}</span>
                  {row.caseBusinessIds.length > 1 ? (
                    <span className="state state-accent">{row.caseBusinessIds.length} cases</span>
                  ) : null}
                  {row.finalizedAt ? (
                    <span className="muted">
                      Finalized{" "}
                      <time dateTime={row.finalizedAt.toISOString()}>
                        {formatUtcMinute(row.finalizedAt)}
                      </time>
                    </span>
                  ) : null}
                </div>
                <div className="row-title">
                  <Link className="row-link" href={`/executions/${row.id}`}>
                    {row.caseTitle}
                  </Link>
                </div>
              </div>
              {row.result ? <OutcomeChip outcome={row.result} /> : null}
              <Link
                className="btn btn-secondary btn-sm"
                href={`/executions/${row.id}`}
                aria-label={`View ${row.businessId}`}
                tabIndex={-1}
              >
                View
                <ChevronRight size={14} aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </div>
      {total > rows.length ? (
        <p className="muted work-done-note">
          Showing the {rows.length} most recent of {total}.{" "}
          <Link href={href}>View all executions</Link>
        </p>
      ) : null}
    </section>
  );
}
