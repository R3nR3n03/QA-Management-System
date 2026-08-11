import Link from "next/link";
import {
  CalendarClock,
  ChevronRight,
  CircleCheck,
  CirclePlay,
  CircleSlash,
  CircleX,
  ClipboardList,
  Play
} from "lucide-react";
import { ExecutionLifecycleState, type ExecutionOutcome } from "@prisma/client";
import { ExecutionStateChip, OutcomeChip } from "./chips";
import { formatUtcMinute, outcomeBreakdown } from "./format";
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
  /**
   * What the run exists to check — the row's headline. Replaces the first covered case's
   * title, which named 1 of N cases as if it were the whole run.
   */
  purpose: string;
  /** The first covered case's priority; shown only for a single-case run. */
  priority: string;
  /**
   * The Jira issue this run is testing, or null. Rendered as text and never as a link — see
   * the note on `JiraNote` below.
   */
  jiraIssueKey: string | null;
  plannedAt: Date;
  startedAt: Date | null;
};

export type FinalizedRowData = {
  id: string;
  businessId: string;
  /** The run's derived worst outcome. `null` should not occur on a finalized run. */
  result: ExecutionOutcome | null;
  caseBusinessIds: string[];
  /** What the run existed to check — the row's headline, as on the open queue above. */
  purpose: string;
  jiraIssueKey: string | null;
  /** Per-case outcomes, in coverage order — the breakdown behind a multi-case run's chip. */
  caseResults: Array<ExecutionOutcome | null>;
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

/**
 * The same marker for a finished run, keyed to its outcome.
 *
 * It replaces the edge stripe these rows used to carry. Both said the outcome in colour,
 * and 12px apart that was one signal spent twice; the marker is also what lines the recap's
 * titles up with the queue's above it, so the two lists read as one column of runs rather
 * than two lists that happen to be stacked. Decorative for the same reason `StateMark` is —
 * the chip beside it carries the word.
 *
 * A null result should not occur on a finalized run, and the row omits its chip when it
 * does. The marker goes neutral to match: a green tick for an outcome nobody recorded would
 * be the one case where this says something the chip does not.
 */
function OutcomeMark({ outcome }: { outcome: ExecutionOutcome | null }) {
  if (outcome === null) {
    return (
      <span className="work-mark" aria-hidden>
        <ClipboardList size={18} />
      </span>
    );
  }
  return (
    <span className="work-mark" data-tone={outcome.toLowerCase()} aria-hidden>
      {outcome === "FAIL" ? (
        <CircleX size={18} />
      ) : outcome === "BLOCKED" ? (
        <CircleSlash size={18} />
      ) : (
        <CircleCheck size={18} />
      )}
    </span>
  );
}

/**
 * The Jira issue a run is testing, last in a row's line of facts.
 *
 * Text rather than a link, the same choice `record-list.tsx` makes for the same reason: a
 * row's one click target is its title — which is why the trailing button is skipped in the
 * tab order — and an external anchor duplicates no destination, so it could not be hidden
 * the same way. 50 rows would be 50 extra tab stops serving the rarer intention, when the
 * run's own screen one click away links the key properly.
 *
 * "No Jira issue" only where the deployment HAS Jira configured. Without it no run could
 * ever carry a key, so the words would report the deployment rather than the run, on every
 * row forever. A recorded key shows either way — it is a fact of the run whether or not
 * anything will ever be sent.
 */
function JiraNote({ issueKey, configured }: { issueKey: string | null; configured: boolean }) {
  if (issueKey) {
    return (
      <>
        {" · "}
        <span className="jira-key">{issueKey}</span>
      </>
    );
  }
  return configured ? <>{" · No Jira issue"}</> : null;
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
  featureKey = "feature",
  jiraConfigured = false
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
  /** Whether this deployment has Jira configured at all. See `JiraNote`. */
  jiraConfigured?: boolean;
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
              <p>
                No run of yours matches &ldquo;{query}&rdquo;
                {scoped ? ` in this ${scopeWord(product, feature)}` : ""}.
              </p>
            ) : scoped ? (
              // The scope is the filter a reader is least likely to be looking at — the
              // tab it emptied is on screen showing a zero, the dropdown is one line of
              // small text — so it gets named.
              <p>No run of yours covers this {scopeWord(product, feature)}.</p>
            ) : tab === ExecutionLifecycleState.PLANNED ? (
              <p>Nothing planned is waiting on you.</p>
            ) : tab === ExecutionLifecycleState.IN_PROGRESS ? (
              <p>You have no run in progress.</p>
            ) : (
              <p>
                Nothing is waiting on you right now.{" "}
                <Link href="/executions">Browse all executions</Link>
              </p>
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
                  {/* The purpose is the click target as well as the trailing button: it is
                      the widest thing in the row and the thing already being read. Not a
                      stretched overlay — that would make the business ID unselectable,
                      and these are IDs people copy into a ticket. */}
                  <div className="row-title">
                    <Link className="row-link" href={`/executions/${row.id}`}>
                      {row.purpose}
                    </Link>
                  </div>
                  {/* The row's line of facts: what it covers, then the ticket it is
                      testing. The Jira key is here BECAUSE the screen's needle matches it —
                      the queue and the executions list share one `executionWhere` — and a
                      tester who pastes a key would otherwise get rows back with nothing on
                      them saying why they matched. */}
                  <div className="muted row-facts">
                    <span className="bid">{row.caseBusinessIds[0]}</span>
                    {row.caseBusinessIds.length > 1
                      ? ` +${row.caseBusinessIds.length - 1} more`
                      : ` · ${row.priority || "no"} priority`}
                    <JiraNote issueKey={row.jiraIssueKey} configured={jiraConfigured} />
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
                  {/* A play glyph rather than the chevron the secondary links carry: this
                      button runs a test, it does not navigate deeper into a record. */}
                  <Play size={12} fill="currentColor" aria-hidden />
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
  href = "/executions",
  jiraConfigured = false
}: {
  rows: FinalizedRowData[];
  /** Finalized runs matching the current filters, before the cap. */
  total: number;
  href?: string;
  /** Whether this deployment has Jira configured at all. See `JiraNote`. */
  jiraConfigured?: boolean;
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
          {rows.map((row) => {
            // A Fail chip on a seven-case run does not say whether one case failed or all
            // seven — the run carries only its derived worst outcome. Single-case runs need
            // no breakdown: their chip already IS the one case's result.
            const breakdown =
              row.caseBusinessIds.length > 1 ? outcomeBreakdown(row.caseResults) : "";
            return (
              // The same four-part row the queue above uses — mark, record, when, action —
              // so the two lists read as one column rather than two shapes.
              <li key={row.id} className="list-row work-row">
                <OutcomeMark outcome={row.result} />
                <div className="row-main">
                  <div className="cluster">
                    <span className="bid">{row.businessId}</span>
                    {row.result ? <OutcomeChip outcome={row.result} /> : null}
                    {row.caseBusinessIds.length > 1 ? (
                      <span className="state state-accent">{row.caseBusinessIds.length} cases</span>
                    ) : null}
                  </div>
                  <div className="row-title">
                    <Link className="row-link" href={`/executions/${row.id}`}>
                      {row.purpose}
                    </Link>
                  </div>
                  {/* The recap used to name no case at all, so a run could be identified
                      here only by its own ID. It carries the queue's line of facts now, for
                      the same reason the queue carries it. */}
                  <div className="muted row-facts">
                    <span className="bid">{row.caseBusinessIds[0]}</span>
                    {row.caseBusinessIds.length > 1
                      ? ` +${row.caseBusinessIds.length - 1} more`
                      : ""}
                    {breakdown ? ` (${breakdown})` : ""}
                    <JiraNote issueKey={row.jiraIssueKey} configured={jiraConfigured} />
                  </div>
                </div>
                {/* Moved out of the cluster into the queue's timestamp slot: the same fact
                    in the same place on both lists, instead of trailing the chips on one
                    and sitting at the row's end on the other. */}
                {row.finalizedAt ? (
                  <span className="muted work-when">
                    <CalendarClock size={13} aria-hidden />
                    Finalized{" "}
                    <time dateTime={row.finalizedAt.toISOString()}>
                      {formatUtcMinute(row.finalizedAt)}
                    </time>
                  </span>
                ) : null}
                <Link
                  className="btn btn-secondary btn-sm work-cta"
                  href={`/executions/${row.id}`}
                  aria-label={`View ${row.businessId}`}
                  tabIndex={-1}
                >
                  View
                  <ChevronRight size={14} aria-hidden />
                </Link>
              </li>
            );
          })}
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
