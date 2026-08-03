import { ExecutionLifecycleState, ExecutionOutcome, QamsRole } from "@prisma/client";
import Link from "next/link";
import { notFound } from "next/navigation";
import { listControlledValues } from "@/domain/admin";
import { listOpenDefectsForCases } from "@/domain/defects";
import { executionDetail, listAssignableTesters } from "@/domain/executions";
import { CATALOGUE_PRIORITY, CATALOGUE_SEVERITY } from "@/lib/controlled-value-catalogues";
import { ExecutionStateChip, OutcomeChip, TestCaseStateChip } from "@/ui/chips";
import { Breadcrumbs } from "@/ui/breadcrumbs";
import { formatUtcMinute } from "@/ui/format";
import { requireSession } from "@/ui/session";
import { Stepper } from "@/ui/stepper";
import { FinalizeForm } from "./FinalizeForm";
import { ReassignForm } from "./ReassignForm";
import { StartForm } from "./StartForm";

const RAIL: { state: ExecutionLifecycleState; label: string }[] = [
  { state: ExecutionLifecycleState.PLANNED, label: "Planned" },
  { state: ExecutionLifecycleState.IN_PROGRESS, label: "In Progress" },
  { state: ExecutionLifecycleState.FINALIZED, label: "Finalized" }
];

/** The moment each stage was reached, or nothing when it has not been. */
function railHint(
  state: ExecutionLifecycleState,
  execution: { createdAt: Date; startedAt: Date | null; finalizedAt: Date | null }
): string | undefined {
  if (state === ExecutionLifecycleState.PLANNED) return formatUtcMinute(execution.createdAt);
  if (state === ExecutionLifecycleState.IN_PROGRESS)
    return execution.startedAt ? formatUtcMinute(execution.startedAt) : undefined;
  return execution.finalizedAt ? formatUtcMinute(execution.finalizedAt) : undefined;
}

export default async function ExecutionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireSession();
  const execution = await executionDetail(id);
  if (!execution) notFound();

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

  // One execution covers one or more cases (`docs/business-rules-and-validation.md:27`);
  // per-case outcome fields live on the covered-case rows, the execution keeps only
  // its derived result.
  const single = execution.cases.length === 1 ? execution.cases[0] : null;
  const caseByTestCaseId = new Map(execution.cases.map((row) => [row.testCaseId, row]));
  const anchor = (businessId: string) => `case-${businessId}`;

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
      <div className="cluster">
        <span className="bid">{execution.businessId}</span>
        <ExecutionStateChip state={execution.state} />
        {execution.result ? <OutcomeChip outcome={execution.result} /> : null}
      </div>

      <h1 style={{ marginTop: "var(--sp-2)" }}>
        {single ? single.testCase.title : `${execution.cases.length} test cases in one run`}
      </h1>

      {/* Identity line: each covered case anchors to its section below. */}
      <div className="row" style={{ marginBottom: "var(--sp-5)" }}>
        {execution.cases.map((covered) => (
          <span key={covered.id} className="cluster">
            <a className="bid" href={`#${anchor(covered.testCase.businessId)}`}>
              {covered.testCase.businessId}
            </a>
            <TestCaseStateChip state={covered.testCase.lifecycleState} />
          </span>
        ))}
        <span className="muted">
          assigned to {execution.tester.displayName}
          {isAssignee ? " (you)" : ""}
        </span>
      </div>

      <Stepper
        steps={RAIL.map((step) => ({
          key: step.state,
          label: step.label,
          hint: railHint(step.state, execution)
        }))}
        currentIndex={currentIndex}
        label="Execution lifecycle"
      />

      <div className="detail-cols">
        <div>
          {execution.cases.map((covered) => (
            <section key={covered.id} id={anchor(covered.testCase.businessId)} style={{ marginBottom: "var(--sp-5)" }}>
              <h2>
                {single ? (
                  "Steps"
                ) : (
                  <>
                    <span className="bid">{covered.testCase.businessId}</span> · {covered.testCase.title}
                  </>
                )}
              </h2>
              {covered.result ? (
                <div className="cluster" style={{ marginBottom: "var(--sp-2)" }}>
                  <OutcomeChip outcome={covered.result} />
                </div>
              ) : null}
              {covered.testCase.steps.length === 0 ? (
                <p className="muted">This test case has no steps recorded.</p>
              ) : (
                // Step lists collapse per case: a single-case run keeps its steps open,
                // the multi-case view starts folded so the page stays scannable.
                <details open={single !== null}>
                  <summary className="muted">
                    {covered.testCase.steps.length} step{covered.testCase.steps.length === 1 ? "" : "s"}
                  </summary>
                  <ol style={{ paddingLeft: "var(--sp-5)", margin: 0 }}>
                    {covered.testCase.steps.map((step) => (
                      <li key={step.id} style={{ marginBottom: "var(--sp-3)" }}>
                        <div style={{ color: "var(--ink)" }}>{step.action}</div>
                        <div className="muted">Expected: {step.expectedResult}</div>
                      </li>
                    ))}
                  </ol>
                </details>
              )}
            </section>
          ))}

          {execution.history.length > 0 ? (
            <>
              <h2 style={{ marginTop: "var(--sp-6)" }}>History</h2>
              <p className="muted">Append-only. Corrections create a new execution, never an edit.</p>
              {execution.history.map((row) => (
                <div key={row.id} className="row" style={{ padding: "var(--sp-2) 0" }}>
                  {!single ? (
                    <span className="bid">
                      {caseByTestCaseId.get(row.testCaseId)?.testCase.businessId ?? row.testCaseId}
                    </span>
                  ) : null}
                  <OutcomeChip outcome={row.result} />
                  <span className="muted">{formatUtcMinute(row.occurredAt)}</span>
                </div>
              ))}
            </>
          ) : null}
        </div>

        <aside>
          <div className="card">
            {/* Finalized first, before the assignment gate: a closed run is assigned to
                nobody's action, so telling a QA Tester that someone else "is running this
                one" would be wrong about a run that is already over. */}
            {execution.state === ExecutionLifecycleState.FINALIZED ? (
              <>
                <h3>Finalized</h3>
                {execution.cases.map((covered) => (
                  <div key={covered.id} style={{ marginBottom: "var(--sp-3)" }}>
                    {!single ? (
                      <div className="cluster" style={{ marginBottom: "var(--sp-1)" }}>
                        <span className="bid">{covered.testCase.businessId}</span>
                        {covered.result ? <OutcomeChip outcome={covered.result} /> : null}
                      </div>
                    ) : null}
                    <p style={{ margin: 0 }}>
                      {covered.actualResult || "No actual result was recorded."}
                    </p>
                    {covered.blockReason ? (
                      <p className="why" style={{ marginTop: "var(--sp-1)" }}>
                        <strong>Blocked:</strong> {covered.blockReason}
                      </p>
                    ) : null}
                  </div>
                ))}
                <p className="muted">
                  This run is closed and cannot be edited. A rerun creates a new execution
                  covering only the failed or blocked case(s).
                </p>
                {rerunCaseIds.length > 0 ? (
                  <Link className="btn" href={`/executions/new?cases=${rerunCaseIds.join(",")}`}>
                    Plan a rerun of {rerunCaseIds.length} case
                    {rerunCaseIds.length === 1 ? "" : "s"}
                  </Link>
                ) : null}
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
            ) : execution.state === ExecutionLifecycleState.PLANNED ? (
              <>
                <h3>Ready to start</h3>
                <StartForm executionId={execution.id} version={execution.version} />
                <ReassignForm
                  executionId={execution.id}
                  version={execution.version}
                  currentTesterId={execution.testerId}
                  testers={assignableTesters}
                />
              </>
            ) : (
              <>
                <h3>Finalize</h3>
                <FinalizeForm
                  executionId={execution.id}
                  version={execution.version}
                  cases={execution.cases.map((covered) => ({
                    testCaseId: covered.testCaseId,
                    businessId: covered.testCase.businessId,
                    title: covered.testCase.title,
                    openDefects: openDefects
                      .filter((defect) => defect.testCaseId === covered.testCaseId)
                      .map((defect) => ({ id: defect.id, businessId: defect.businessId, summary: defect.summary }))
                  }))}
                  priorities={priorities}
                  severities={severities}
                />
              </>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}
