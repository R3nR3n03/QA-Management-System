import type { ReactNode } from "react";
import {
  ExecutionLifecycleState,
  ExecutionOutcome,
  JiraCommentOutcome,
  JiraSyncOutcome,
  QamsRole
} from "@prisma/client";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDays, CircleCheckBig, Clock, FileText } from "lucide-react";
import { listControlledValues } from "@/domain/admin";
import { listOpenDefectsForCases } from "@/domain/defects";
import { executionDetail, listAssignableTesters } from "@/domain/executions";
import { CATALOGUE_PRIORITY, CATALOGUE_SEVERITY } from "@/lib/controlled-value-catalogues";
import { jiraConnectionStatus, jiraIssueUrl } from "@/lib/jira-config";
import { ExecutionStateChip, OutcomeChip, TestCaseStateChip } from "@/ui/chips";
import { Breadcrumbs } from "@/ui/breadcrumbs";
import { formatUtcMinute } from "@/ui/format";
import { hrefWith, readPage, readParam, type ListSearchParams } from "@/ui/list-params";
import { Pager } from "@/ui/pager";
import { pageSlice } from "@/ui/paging";
import { UrlFilterToolbar } from "@/ui/toolbar";
import { requireSession } from "@/ui/session";
import { StepsDisclosure } from "@/ui/steps-disclosure";
import { Stepper } from "@/ui/stepper";
import { FinalizeForm } from "./FinalizeForm";
import { PlannedRunForm } from "./PlannedRunForm";
import { RunSummary } from "./RunSummary";
import { StartForm } from "./StartForm";

const RAIL: { state: ExecutionLifecycleState; label: string; icon: ReactNode }[] = [
  {
    state: ExecutionLifecycleState.PLANNED,
    label: "Planned",
    icon: <CalendarDays size={17} strokeWidth={1.9} />
  },
  {
    state: ExecutionLifecycleState.IN_PROGRESS,
    label: "In Progress",
    icon: <Clock size={17} strokeWidth={1.9} />
  },
  {
    state: ExecutionLifecycleState.FINALIZED,
    label: "Finalized",
    icon: <CircleCheckBig size={17} strokeWidth={1.9} />
  }
];

/**
 * The moment each stage was reached, or "Not yet" when it has not been.
 *
 * An unreached stage says so in words rather than leaving the line out. As a bar
 * segment an omitted hint was right — a missing caption reads as "no timestamp here".
 * As a TILE it reads as a rendering fault: two cards with two lines beside one with a
 * stray centred label. The words also make the stepper's claim complete without colour,
 * which the empty slot left to inference.
 */
function railHint(
  state: ExecutionLifecycleState,
  execution: { createdAt: Date; startedAt: Date | null; finalizedAt: Date | null }
): string {
  if (state === ExecutionLifecycleState.PLANNED) return formatUtcMinute(execution.createdAt);
  if (state === ExecutionLifecycleState.IN_PROGRESS)
    return execution.startedAt ? formatUtcMinute(execution.startedAt) : "Not yet";
  return execution.finalizedAt ? formatUtcMinute(execution.finalizedAt) : "Not yet";
}

/**
 * The views a reader may take over a run's covered cases.
 *
 * "PENDING" is not an outcome the model has — it is the absence of one, which is exactly
 * what a reader of a part-graded run wants to isolate. It is named "Not graded" rather
 * than "Skipped": policy defines three outcomes (`docs/business-rules-and-validation.md`),
 * and a fourth word on the same strip would read as a fourth grade.
 */
const OUTCOME_VIEWS: { value: string; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: ExecutionOutcome.PASS, label: "Pass" },
  { value: ExecutionOutcome.FAIL, label: "Fail" },
  { value: ExecutionOutcome.BLOCKED, label: "Blocked" },
  { value: "PENDING", label: "Not graded" }
];

/* The three keys this screen owns in the query string. Named apart from the record
   lists' `q`/`page` because a covered-case list is not the executions list — a link
   carrying both would otherwise cross-talk. */
const OUTCOME_PARAM = "outcome";
const CASE_QUERY_PARAM = "caseq";
const CASE_PAGE_PARAM = "casepage";

/** A hand-edited `?outcome=` that names nothing shows every case rather than none. */
function readOutcomeView(params: ListSearchParams): string {
  const raw = readParam(params, OUTCOME_PARAM);
  return OUTCOME_VIEWS.some((view) => view.value === raw) ? raw : "ALL";
}

function matchesView(view: string, result: ExecutionOutcome | null): boolean {
  if (view === "ALL") return true;
  if (view === "PENDING") return result === null;
  return result === view;
}

export default async function ExecutionPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<ListSearchParams>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const auth = await requireSession();
  const execution = await executionDetail(id);
  if (!execution) notFound();

  /* Deployment configuration, so it is read here and never asked for by a component.
     `jiraIssueHref` is null in the two cases that both render plain text: no Jira configured,
     and a run carrying no key. */
  const jira = jiraConnectionStatus();
  const jiraIssueHref = jiraIssueUrl(jira.baseUrl, execution.jiraIssueKey);
  /* The latest result-comment attempt, or undefined when none was ever made. */
  const commentAttempt = execution.jiraCommentAttempts[0];
  /* The latest transition attempt, including one QAMS deliberately skipped (ADR-0005). */
  const syncAttempt = execution.jiraSyncAttempts[0];

  const controlled = await listControlledValues();
  const priorities = controlled
    .filter((v) => v.catalogue === CATALOGUE_PRIORITY && v.active)
    .map((v) => v.value);
  const severities = controlled
    .filter((v) => v.catalogue === CATALOGUE_SEVERITY && v.active)
    .map((v) => v.value);

  // roles-workflows.md:36-37 — a QA Tester may only act on an execution assigned to
  // them. Everyone else may act on any. Enforced in the domain service either way
  // (ensureAssignedTester); this only decides whether to offer the control or
  // explain why it is unavailable.
  const isAssignee = execution.testerId === auth.userId;
  const mayAct = auth.role !== QamsRole.QA_TESTER || isAssignee;

  // Reassignment is offered only while Planned (the domain refuses it afterwards),
  // so the tester list is fetched only when the form will render.
  const assignableTesters =
    mayAct && execution.state === ExecutionLifecycleState.PLANNED ? await listAssignableTesters() : [];

  // Open defects per covered case, offered as link targets when finalizing a failing
  // case — one read for the whole form, fetched only when the form will render.
  const openDefects =
    mayAct && execution.state === ExecutionLifecycleState.IN_PROGRESS
      ? await listOpenDefectsForCases(execution.cases.map((covered) => covered.testCaseId))
      : [];

  const currentIndex = RAIL.findIndex((step) => step.state === execution.state);

  // Recording results IS the work on an In Progress run, so the finalize form takes the
  // record's whole two-column layout: the wide column becomes the working list of cases
  // and the rail becomes the commit panel. The read-only layout below serves every other
  // state. (Nothing is lost by not rendering History here — history rows are written
  // only by `finalizeExecution`, so an In Progress run has none.)
  const working = execution.state === ExecutionLifecycleState.IN_PROGRESS && mayAct;

  // One execution covers one or more cases (`docs/business-rules-and-validation.md:27`);
  // per-case outcome fields live on the covered-case rows, the execution keeps only
  // its derived result.
  const single = execution.cases.length === 1 ? execution.cases[0] : null;
  const caseByTestCaseId = new Map(execution.cases.map((row) => [row.testCaseId, row]));

  // The counts behind the view strip below, off the PERSISTED results. The summary card
  // has its own count (`RunSummary`) because it also has to speak for a run being worked,
  // whose results are not persisted yet; the strip only ever renders on a run that is not.
  const countOf = (view: string) =>
    execution.cases.filter((covered) => matchesView(view, covered.result)).length;
  const graded = execution.cases.filter((covered) => covered.result !== null).length;

  // The view strip earns its place only once something has been graded: on a Planned run
  // every segment but "Not graded" reads zero, which is four controls saying nothing.
  const outcomeView = readOutcomeView(query);
  const showViews = execution.cases.length > 1 && graded > 0;

  // Needle, then view, then page — the same order the record lists apply them in, so a
  // covered-case list of a hundred behaves like every other list in the product.
  const caseNeedle = readParam(query, CASE_QUERY_PARAM);
  const needle = caseNeedle.toLowerCase();
  const matchedCases = execution.cases.filter(
    (covered) =>
      (!showViews || matchesView(outcomeView, covered.result)) &&
      (needle === "" ||
        covered.testCase.businessId.toLowerCase().includes(needle) ||
        covered.testCase.title.toLowerCase().includes(needle))
  );
  // `pageSlice` clamps, so an out-of-range `?casepage=` lands on the last page rather
  // than on nothing — which is why the empty state below only has to explain filters.
  const casePage = readPage(query, CASE_PAGE_PARAM);
  const visibleCases = pageSlice(matchedCases, casePage);

  // Three screens already tell the reader that a rerun is a new execution covering only
  // the failed or blocked case(s) — and none of them offered a way to start one, so the
  // reader had to re-find those cases by hand on the planning screen. This carries them
  // across as a preselection; `/executions/new` still decides what may actually be
  // planned (only Approved cases are offered, and `createExecution` re-checks that).
  const rerunCaseIds =
    execution.state === ExecutionLifecycleState.FINALIZED
      ? execution.cases
          .filter(
            (covered) =>
              covered.result === ExecutionOutcome.FAIL || covered.result === ExecutionOutcome.BLOCKED
          )
          .map((covered) => covered.testCaseId)
      : [];

  return (
    <>
      <Breadcrumbs trail={[{ href: "/executions", label: "Executions" }]} here={execution.businessId} />

      {/* The record's identity is its business ID — the thing people quote, search and
          compare — so that is the h1, with the two chips that qualify it beside it. The
          purpose is the line under it, the same headline the run is listed under; what it
          covers follows in the line of facts, where a multi-case run can say so without
          pretending to be one case. */}
      <div className="page-head">
        <div className="cluster">
          <h1 className="run-id">{execution.businessId}</h1>
          <ExecutionStateChip state={execution.state} />
          {execution.result ? <OutcomeChip outcome={execution.result} /> : null}
        </div>
        {rerunCaseIds.length > 0 ? (
          /* `from` carries the source run, not its text: the plan screen looks the purpose up
             server-side so a sentence never travels through a query string. */
          <Link
            className="btn btn-secondary"
            href={`/executions/new?cases=${rerunCaseIds.join(",")}&from=${execution.id}`}
          >
            Plan a rerun of {rerunCaseIds.length} case{rerunCaseIds.length === 1 ? "" : "s"}
          </Link>
        ) : null}
      </div>

      <p className="run-lede">{execution.purpose}</p>
      {/* Assignment and the Jira task, in one line of facts about the run.

          The issue key used to be visible ONLY inside the reassignment form's input, which
          mounts only on a Planned run for a viewer who may act on it — so a tester could set
          a key and never see it again, and nobody could read it off a Finalized run at all.
          It belongs here instead: an attribute of the record, in every lifecycle state, for
          every role that may view the run. */}
      <p className="muted" style={{ marginBottom: "var(--sp-4)" }}>
        {/* What the run covers. It moved off the lede when the purpose took that slot, and
            it is a fact about the run like the assignee and the Jira task, so it reads in
            the same line as them. */}
        {single ? single.testCase.title : `${execution.cases.length} test cases in one run`}
        {" · Assigned to "}
        {execution.tester.displayName}
        {isAssignee ? " (you)" : ""}
        {execution.jiraIssueKey ? (
          <>
            {" · Testing "}
            {/* "Testing PROJ-123" rather than a bare key: in a line of facts a bare
                identifier could be read as another QAMS business ID, and this one names a
                row in someone else's database. A new tab because a tester mid-run should
                not lose the run to glance at a ticket. */}
            {jiraIssueHref ? (
              <a
                className="jira-key"
                href={jiraIssueHref}
                target="_blank"
                /* Not optional with `target="_blank"`: without it the opened page gets a
                   `window.opener` handle back into this one. Same reasoning as the Connect
                   link in `jira-connection.tsx`. */
                rel="noopener noreferrer"
                /* The new tab is announced. "Connect Jira" is a control where a reader
                   expects one; a key inside a sentence is not, and focus moving to another
                   tab unannounced is disorienting. */
                aria-label={`${execution.jiraIssueKey} in Jira, opens in a new tab`}
              >
                {execution.jiraIssueKey}
              </a>
            ) : (
              /* A key recorded while the integration is switched off. Still a fact of the
                 run, with nowhere to send the reader. */
              <span className="jira-key">{execution.jiraIssueKey}</span>
            )}
            {/* Whether the result comment reached Jira.

                Nothing renders when there is no attempt row, which covers every "we never
                tried" case at once: commenting switched off, the run finalized before the
                feature existed, or the run not finalized yet. Absence must never read as a
                failure.

                A failure is shown to anyone who can open the run, reason included. It is
                sanitized of credential material by contract (`sanitizeFailureReason`), and the
                person who typed a wrong issue key is the one best placed to notice — hiding it
                behind a role would turn a self-service fix into a support request. Nothing
                retries it, so this line is the whole recovery story. */}
            {commentAttempt ? (
              commentAttempt.outcome === JiraCommentOutcome.SUCCEEDED ? (
                <span className="muted"> · Results posted to Jira</span>
              ) : (
                <span className="muted-warn">
                  {" · Results not posted to Jira"}
                  {commentAttempt.failureReason ? `: ${commentAttempt.failureReason}` : ""}
                </span>
              )
            ) : null}
            {/* Whether the ISSUE moved, which is the half a reader actually asks about.
                Nothing renders without an attempt row, on the same rule as the comment above.

                SKIPPED is the case this line exists for: QAMS was working correctly and chose
                not to transition, and before ADR-0005 that decision was indistinguishable
                from a broken integration because it wrote nothing anywhere. It reads as
                neutral rather than as a warning, because nothing is wrong and there may be
                nothing to fix — the reason names the run that is holding the issue open. */}
            {syncAttempt ? (
              syncAttempt.outcome === JiraSyncOutcome.SUCCEEDED ? (
                <span className="muted"> · Issue transitioned to Done</span>
              ) : syncAttempt.outcome === JiraSyncOutcome.SKIPPED ? (
                <span className="muted">
                  {" · Issue not transitioned"}
                  {syncAttempt.failureReason ? `: ${syncAttempt.failureReason}` : ""}
                </span>
              ) : (
                <span className="muted-warn">
                  {" · Issue could not be transitioned"}
                  {syncAttempt.failureReason ? `: ${syncAttempt.failureReason}` : ""}
                </span>
              )
            ) : null}
          </>
        ) : jira.connected ? (
          " · No Jira issue"
        ) : null}
      </p>

      <div className="run-head">
        <Stepper
          variant="cards"
          steps={RAIL.map((step) => ({
            key: step.state,
            label: step.label,
            hint: railHint(step.state, execution),
            icon: step.icon
          }))}
          currentIndex={currentIndex}
          label="Execution lifecycle"
        />

        {/* The tally lives in a client component because on a run being worked the results
            it counts are held in the browser, not on the server — see `RunSummary`. */}
        <RunSummary
          cases={execution.cases.map((covered) => ({
            testCaseId: covered.testCaseId,
            result: covered.result
          }))}
          draft={working ? { executionId: execution.id, version: execution.version } : null}
        />
      </div>

      {working ? (
        <FinalizeForm
          executionId={execution.id}
          version={execution.version}
          cases={execution.cases.map((covered) => ({
            testCaseId: covered.testCaseId,
            businessId: covered.testCase.businessId,
            title: covered.testCase.title,
            steps: covered.testCase.steps.map((step) => ({
              id: step.id,
              action: step.action,
              expectedResult: step.expectedResult
            })),
            openDefects: openDefects
              .filter((defect) => defect.testCaseId === covered.testCaseId)
              .map((defect) => ({ id: defect.id, businessId: defect.businessId, summary: defect.summary }))
          }))}
          priorities={priorities}
          severities={severities}
        />
      ) : (
      <div className="detail-cols">
        <div>
          <div className="row" style={{ marginBottom: "var(--sp-3)" }}>
            <h2 style={{ margin: 0, flex: 1 }}>
              {single ? "Covered case" : `Covered cases (${execution.cases.length})`}
            </h2>
            {/* The same >5 rule the record lists use. Its own key, and it resets this
                list's page — not the record lists' `q`/`page`. */}
            {execution.cases.length > 5 ? (
              <UrlFilterToolbar
                placeholder="Search cases…"
                label="Search covered cases"
                paramKey={CASE_QUERY_PARAM}
                pageKey={CASE_PAGE_PARAM}
              />
            ) : null}
          </div>

          {showViews ? (
            <div
              className="seg"
              role="group"
              aria-label="Filter covered cases by outcome"
              style={{ marginBottom: "var(--sp-3)" }}
            >
              {OUTCOME_VIEWS.map((view) => (
                <Link
                  key={view.value}
                  // Changing the view returns to page 1: staying on page 3 of a
                  // now-shorter list would land on the last page, not the one asked for.
                  href={hrefWith(`/executions/${execution.id}`, query, {
                    [OUTCOME_PARAM]: view.value === "ALL" ? null : view.value,
                    [CASE_PAGE_PARAM]: null
                  })}
                  aria-current={view.value === outcomeView ? "true" : undefined}
                  scroll={false}
                >
                  {view.label} <span className="seg-count">{countOf(view.value)}</span>
                </Link>
              ))}
            </div>
          ) : null}

          <div className="card card-flush">
            {visibleCases.length === 0 ? (
              <div className="empty">
                {/* Two filters can empty this list and the sentence has to name the one
                    that did — "nothing matches" with no needle reads as a bug. And the
                    absence of an outcome is not the absence of a grade: "graded not
                    graded" is neither sentence. */}
                <p>
                  {caseNeedle !== "" ? (
                    <>Nothing matches &ldquo;{caseNeedle}&rdquo;{outcomeView === "ALL" ? "" : " in this view"}.</>
                  ) : outcomeView === "PENDING" ? (
                    "Every covered case in this run has been graded."
                  ) : (
                    `No covered case in this run was graded ${
                      OUTCOME_VIEWS.find((view) => view.value === outcomeView)?.label ?? ""
                    }.`
                  )}
                </p>
                <Link className="btn btn-secondary btn-sm" href={`/executions/${execution.id}`}>
                  Show all {execution.cases.length} cases
                </Link>
              </div>
            ) : (
              <ul className="row-list">
                {visibleCases.map((covered) => (
                  // The outcome as a stripe down the row's edge. Reinforcement only: the
                  // chip on the right already carries the word, so a greyscale or
                  // colour-blind reader loses nothing (principle 2).
                  <li key={covered.id} className="case-item" data-outcome={covered.result ?? undefined}>
                    <div className="case-item-head">
                      <span className="case-item-mark" aria-hidden>
                        <FileText size={16} strokeWidth={1.9} />
                      </span>
                      <div className="row-main">
                        <div className="cluster">
                          <span className="bid">{covered.testCase.businessId}</span>
                          <TestCaseStateChip state={covered.testCase.lifecycleState} />
                          {/* The size of the job, on the row rather than only inside the
                              steps disclosure — the working list says it here too. */}
                          <span className="muted">
                            {covered.testCase.steps.length} step
                            {covered.testCase.steps.length === 1 ? "" : "s"}
                          </span>
                        </div>
                        {/* The title is the click target, and it goes to the CASE, not
                            back to this run: the reader following a title wants the spec
                            they are being graded against. */}
                        <div className="row-title">
                          <Link className="row-link" href={`/test-cases/${covered.testCaseId}`}>
                            {covered.testCase.title}
                          </Link>
                        </div>
                      </div>
                      {covered.result ? (
                        <OutcomeChip outcome={covered.result} />
                      ) : (
                        <span className="muted">Not graded</span>
                      )}
                    </div>

                    {/* The evidence this run recorded, on the case it belongs to. It used
                        to live in the 340px rail, which repeated every case ID a second
                        time and put the outcome and its reason a column apart. */}
                    {covered.actualResult ? <p className="case-said">{covered.actualResult}</p> : null}
                    {covered.blockReason ? (
                      <p className="why" style={{ marginTop: "var(--sp-2)" }}>
                        <strong>Blocked:</strong> {covered.blockReason}
                      </p>
                    ) : null}

                    {/* Steps fold per case: a single-case run keeps them open, a
                        multi-case run starts folded so the list stays scannable. */}
                    <StepsDisclosure steps={covered.testCase.steps} open={single !== null} />
                  </li>
                ))}
              </ul>
            )}
            {/* `total` is the count AFTER filtering, so the range line tracks the view.
                No rows-per-page control: the covered set is bounded by what the planner
                chose, and one more control here would outweigh the list it governs. */}
            <Pager
              total={matchedCases.length}
              page={casePage}
              pathname={`/executions/${execution.id}`}
              params={query}
              pageKey={CASE_PAGE_PARAM}
              label="covered cases"
            />
          </div>
        </div>

        <aside className="stack">
          <div className="card">
            {/* Finalized first, before the assignment gate: a closed run is assigned to
                nobody's action, so telling a QA Tester that someone else "is running this
                one" would be wrong about a run that is already over. */}
            {execution.state === ExecutionLifecycleState.FINALIZED ? (
              <>
                <h3>Finalized</h3>
                <p className="muted">
                  This run is closed and cannot be edited. Every case&rsquo;s recorded result is on
                  its row. A rerun creates a new execution covering only the failed or blocked
                  case(s).
                </p>
                {/* Who closed it and when. The header says who the run is ASSIGNED to,
                    which is the same person here but not the same fact — and the finalized
                    timestamp was readable only off the stage card. */}
                <dl className="fact-grid">
                  <div>
                    <dt>Finalized on</dt>
                    <dd>
                      {execution.finalizedAt ? (
                        <time dateTime={execution.finalizedAt.toISOString()}>
                          {formatUtcMinute(execution.finalizedAt)}
                        </time>
                      ) : (
                        "Not recorded"
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Executed by</dt>
                    <dd>{execution.tester.displayName}</dd>
                  </div>
                </dl>
              </>
            ) : !mayAct ? (
              <>
                <h3>Assigned to someone else</h3>
                <p className="why">
                  <strong>{execution.tester.displayName} is running this one.</strong> As a QA
                  Tester you can act on the executions assigned to you. Ask a QA Engineer or above
                  if it needs reassigning.
                </p>
              </>
            ) : (
              <>
                <h3>Ready to start</h3>
                <StartForm executionId={execution.id} version={execution.version} />
                <PlannedRunForm
                  executionId={execution.id}
                  version={execution.version}
                  currentPurpose={execution.purpose}
                  currentTesterId={execution.testerId}
                  currentJiraIssueKey={execution.jiraIssueKey}
                  testers={assignableTesters}
                />
              </>
            )}
          </div>

          {execution.history.length > 0 ? (
            <div className="card">
              <h3>History</h3>
              <p className="muted">Append-only. Corrections create a new execution, never an edit.</p>
              <ol className="history-list">
                {execution.history.map((row) => (
                  <li key={row.id} className="history-row">
                    {!single ? (
                      <span className="bid">
                        {caseByTestCaseId.get(row.testCaseId)?.testCase.businessId ?? row.testCaseId}
                      </span>
                    ) : null}
                    <OutcomeChip outcome={row.result} />
                    <time className="muted" dateTime={row.occurredAt.toISOString()}>
                      {formatUtcMinute(row.occurredAt)}
                    </time>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </aside>
      </div>
      )}
    </>
  );
}
