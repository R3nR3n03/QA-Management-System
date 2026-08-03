import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { DefectLifecycleState, ExecutionLifecycleState, ExecutionOutcome } from "@prisma/client";
import { DefectStatusChip, ExecutionStateChip, OutcomeChip } from "./chips";
import { formatUtcMinute } from "./format";
import { hrefWith, readParam, type ListSearchParams } from "./list-params";
import { Pager } from "./pager";
import { PAGE_SIZE, PAGE_SIZE_OPTIONS } from "./paging";
import { UrlFilterToolbar } from "./toolbar";

/**
 * The filterable record lists for executions and defects.
 *
 * Server components: `rows` is the page the database returned and `total` is its
 * `COUNT`, so the filter needle, the state chip and the page number all live in the
 * query string rather than in `useState`. That is what lets the server fetch only the
 * rows on screen — and it keeps `./chips`, which reads its labels off the Prisma enums,
 * out of the browser bundle.
 *
 * Presentation only: which rows exist is the server's answer; what the viewer may do
 * with one is the domain's.
 */

export type ExecutionRowData = {
  id: string;
  businessId: string;
  state: ExecutionLifecycleState;
  result: ExecutionOutcome | null;
  /** Business IDs of every covered case, in coverage order. */
  caseBusinessIds: string[];
  /** The first covered case's title. */
  caseTitle: string;
  testerName: string;
  /** Per-case outcomes, in coverage order; `null` until the run is finalized. */
  caseResults: Array<ExecutionOutcome | null>;
  plannedAt: Date;
  startedAt: Date | null;
  finalizedAt: Date | null;
};

const EXECUTION_STATE_FILTERS: Array<{ value: string; label: string }> = [
  { value: "ALL", label: "All" },
  { value: "PLANNED", label: "Planned" },
  { value: "IN_PROGRESS", label: "In Progress" },
  { value: "FINALIZED", label: "Finalized" }
];

/**
 * The one timestamp a row shows: the most recent thing that happened to the run, named.
 *
 * A row that printed all three stamps would be three-quarters noise — the earlier ones
 * are on the detail screen's stepper, where the stage they belong to is also on screen.
 * The verb is carried in the text because the same column means a different event per
 * row, and a bare date would leave the reader guessing which.
 */
function lastEvent(row: ExecutionRowData): { verb: string; at: Date } {
  if (row.finalizedAt) return { verb: "Finalized", at: row.finalizedAt };
  if (row.startedAt) return { verb: "Started", at: row.startedAt };
  return { verb: "Planned", at: row.plannedAt };
}

/**
 * "2 passed, 1 failed" for a finalized run covering more than one case.
 *
 * The run's own chip carries only the derived worst outcome
 * (`docs/business-rules-and-validation.md:30`), so a 9-pass/1-fail run and a 10-fail run
 * are the same red Fail chip. This says which, in words, without a second colour channel
 * on a row that already has two. Counted in a fixed order so two rows always read the
 * same way, and outcomes with no cases are omitted rather than printed as zero.
 */
function outcomeBreakdown(results: Array<ExecutionOutcome | null>): string {
  const order: Array<[ExecutionOutcome, string]> = [
    ["PASS" as ExecutionOutcome, "passed"],
    ["FAIL" as ExecutionOutcome, "failed"],
    ["BLOCKED" as ExecutionOutcome, "blocked"]
  ];
  const parts = order
    .map(([outcome, word]) => [results.filter((r) => r === outcome).length, word] as const)
    .filter(([count]) => count > 0)
    .map(([count, word]) => `${count} ${word}`);
  return parts.join(", ");
}

export function ExecutionList({
  rows,
  total,
  page,
  pathname,
  params,
  pageSize = PAGE_SIZE,
  queryKey = "q",
  pageKey = "page",
  stateKey = "state"
}: {
  rows: ExecutionRowData[];
  total: number;
  page: number;
  pathname: string;
  params: ListSearchParams | undefined;
  pageSize?: number;
  queryKey?: string;
  pageKey?: string;
  stateKey?: string;
}) {
  const query = readParam(params, queryKey);
  const activeState = readParam(params, stateKey) || "ALL";
  const filtered = query !== "" || activeState !== "ALL";

  if (total === 0 && !filtered) {
    return (
      <div className="card empty">
        <p>No executions yet. Plan one against an approved test case.</p>
      </div>
    );
  }

  return (
    <>
      <div className="row">
        {/* An active filter keeps the controls on screen however few rows match, or
            there would be no way left to clear it. */}
        {query !== "" || total > 5 ? (
          <UrlFilterToolbar
            placeholder="Filter by ID, case, tester, or state…"
            label="Filter executions"
            paramKey={queryKey}
            pageKey={pageKey}
          />
        ) : null}
        <div className="cluster" role="group" aria-label="Filter by lifecycle state">
          {EXECUTION_STATE_FILTERS.map((option) => (
            <Link
              key={option.value}
              className={option.value === activeState ? "btn btn-sm" : "btn btn-secondary btn-sm"}
              // Changing the state filter returns to page 1: staying on page 4 of a
              // now-shorter list would land on nothing.
              href={hrefWith(pathname, params, {
                [stateKey]: option.value === "ALL" ? null : option.value,
                [pageKey]: null
              })}
              aria-current={option.value === activeState ? "true" : undefined}
              scroll={false}
            >
              {option.label}
            </Link>
          ))}
        </div>
      </div>
      <div className="card card-flush">
        {rows.length === 0 ? (
          <div className="empty">
            <p>No execution matches the current filters.</p>
          </div>
        ) : (
          rows.map((row) => {
            const event = lastEvent(row);
            const breakdown =
              row.caseBusinessIds.length > 1 ? outcomeBreakdown(row.caseResults) : "";
            return (
              <div key={row.id} className="list-row">
                <div className="row-main">
                  <div className="cluster">
                    <span className="bid">{row.businessId}</span>
                    <ExecutionStateChip state={row.state} />
                    {row.result ? <OutcomeChip outcome={row.result} /> : null}
                    {row.caseBusinessIds.length > 1 ? (
                      <span className="state">{row.caseBusinessIds.length} cases</span>
                    ) : null}
                  </div>
                  {/* The title is the click target, not just the trailing control: it is the
                      widest thing in the row and the thing a reader is already looking at.
                      The row is deliberately NOT one stretched link — an overlay covering it
                      would make the business ID unselectable, and these are IDs people copy. */}
                  <div className="row-title">
                    <Link className="row-link" href={`/executions/${row.id}`}>
                      {row.caseTitle}
                    </Link>
                  </div>
                  <div className="muted">
                    <span className="bid">{row.caseBusinessIds[0]}</span>
                    {row.caseBusinessIds.length > 1 ? ` +${row.caseBusinessIds.length - 1} more` : ""}
                    {breakdown ? ` (${breakdown})` : ""}
                    {" · "}
                    {row.testerName}
                    {" · "}
                    {event.verb} <time dateTime={event.at.toISOString()}>{formatUtcMinute(event.at)}</time>
                  </div>
                </div>
                {/* The same destination as the title, so it is skipped in the tab order:
                    50 rows would otherwise be 100 tab stops to reach 50 places. It stays a
                    real link for the pointer, and keeps the affordance visible. */}
                <Link
                  className="btn btn-secondary btn-sm"
                  href={`/executions/${row.id}`}
                  aria-label={`View ${row.businessId}`}
                  tabIndex={-1}
                >
                  View
                  <ChevronRight size={14} aria-hidden />
                </Link>
              </div>
            );
          })
        )}
        <Pager
          total={total}
          page={page}
          pathname={pathname}
          params={params}
          pageKey={pageKey}
          pageSize={pageSize}
          sizeOptions={PAGE_SIZE_OPTIONS}
          label="executions"
        />
      </div>
    </>
  );
}

export type DefectRowData = {
  id: string;
  businessId: string;
  status: DefectLifecycleState;
  summary: string;
  priority: string;
  severity: string;
  caseBusinessId: string;
};

export function DefectList({
  rows,
  total,
  page,
  pathname,
  params,
  pageSize = PAGE_SIZE,
  queryKey = "q",
  pageKey = "page"
}: {
  rows: DefectRowData[];
  total: number;
  page: number;
  pathname: string;
  params: ListSearchParams | undefined;
  pageSize?: number;
  queryKey?: string;
  pageKey?: string;
}) {
  const query = readParam(params, queryKey);

  if (total === 0 && query === "") {
    return (
      <div className="card empty">
        <p>No defects recorded.</p>
      </div>
    );
  }

  return (
    <>
      {query !== "" || total > 5 ? (
        <UrlFilterToolbar
          placeholder="Filter by ID, summary, severity, or status…"
          label="Filter defects"
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
          rows.map((defect) => (
            <div key={defect.id} className="list-row">
              <div className="row-main">
                <div className="cluster">
                  <span className="bid">{defect.businessId}</span>
                  <DefectStatusChip status={defect.status} />
                </div>
                <div className="row-title">{defect.summary}</div>
                <div className="muted">
                  <span className="bid">{defect.caseBusinessId}</span>
                  {" · "}
                  {defect.priority || "no"} priority · {defect.severity || "no"} severity
                </div>
              </div>
              <Link href={`/defects/${defect.id}`} style={{ fontSize: 14 }}>
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
          label="defects"
        />
      </div>
    </>
  );
}
