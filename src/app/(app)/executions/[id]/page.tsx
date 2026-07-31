import { ExecutionLifecycleState, QamsRole } from "@prisma/client";
import { notFound } from "next/navigation";
import { listControlledValues } from "@/domain/admin";
import { executionDetail, listAssignableTesters } from "@/domain/executions";
import { CATALOGUE_PRIORITY, CATALOGUE_SEVERITY } from "@/lib/controlled-value-catalogues";
import { ExecutionStateChip, OutcomeChip, TestCaseStateChip } from "@/ui/chips";
import { Breadcrumbs } from "@/ui/breadcrumbs";
import { requireSession } from "@/ui/session";
import { FinalizeForm } from "./FinalizeForm";
import { ReassignForm } from "./ReassignForm";
import { StartForm } from "./StartForm";

const RAIL: { state: ExecutionLifecycleState; label: string }[] = [
  { state: ExecutionLifecycleState.PLANNED, label: "Planned" },
  { state: ExecutionLifecycleState.IN_PROGRESS, label: "In Progress" },
  { state: ExecutionLifecycleState.FINALIZED, label: "Finalized" }
];

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

  const currentIndex = RAIL.findIndex((step) => step.state === execution.state);

  return (
    <>
      <Breadcrumbs trail={[{ href: "/executions", label: "Executions" }]} here={execution.businessId} />
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", flexWrap: "wrap" }}>
        <span className="bid">{execution.businessId}</span>
        <ExecutionStateChip state={execution.state} />
        {execution.result ? <OutcomeChip outcome={execution.result} /> : null}
      </div>

      <h1 style={{ marginTop: "var(--sp-2)" }}>{execution.testCase.title}</h1>

      <p className="muted" style={{ marginBottom: "var(--sp-5)" }}>
        <span className="bid">{execution.testCase.businessId}</span>{" "}
        <TestCaseStateChip state={execution.testCase.lifecycleState} /> · assigned to{" "}
        {execution.tester.displayName}
        {isAssignee ? " (you)" : ""}
      </p>

      <div style={{ display: "flex", marginBottom: "var(--sp-6)", flexWrap: "wrap" }}>
        {RAIL.map((step, i) => (
          <span
            key={step.state}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              fontSize: 13,
              fontWeight: 600,
              padding: "6px 14px",
              border: "1px solid var(--line)",
              borderLeft: i === 0 ? "1px solid var(--line)" : "0",
              borderRadius: i === 0 ? "3px 0 0 3px" : i === RAIL.length - 1 ? "0 3px 3px 0" : "0",
              background: i === currentIndex ? "var(--accent-wash)" : "var(--surface-2)",
              color: i === currentIndex ? "var(--accent)" : i < currentIndex ? "var(--ink-2)" : "var(--ink-3)"
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background:
                  i === currentIndex ? "var(--accent)" : i < currentIndex ? "var(--pass)" : "var(--line)"
              }}
            />
            {step.label}
          </span>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,340px)", gap: "var(--sp-6)" }}>
        <div>
          <h2>Steps</h2>
          {execution.testCase.steps.length === 0 ? (
            <p className="muted">This test case has no steps recorded.</p>
          ) : (
            <ol style={{ paddingLeft: "var(--sp-5)", margin: 0 }}>
              {execution.testCase.steps.map((step) => (
                <li key={step.id} style={{ marginBottom: "var(--sp-3)" }}>
                  <div style={{ color: "var(--ink)" }}>{step.action}</div>
                  <div className="muted">Expected: {step.expectedResult}</div>
                </li>
              ))}
            </ol>
          )}

          {execution.history.length > 0 ? (
            <>
              <h2 style={{ marginTop: "var(--sp-6)" }}>History</h2>
              <p className="muted">Append-only. Corrections create a new execution, never an edit.</p>
              {execution.history.map((row) => (
                <div key={row.id} style={{ display: "flex", gap: "var(--sp-3)", alignItems: "center", padding: "var(--sp-2) 0" }}>
                  <OutcomeChip outcome={row.result} />
                  <span className="muted">{row.occurredAt.toISOString().replace("T", " ").slice(0, 16)} UTC</span>
                </div>
              ))}
            </>
          ) : null}
        </div>

        <aside>
          <div className="card">
            {!mayAct ? (
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
            ) : execution.state === ExecutionLifecycleState.IN_PROGRESS ? (
              <>
                <h3>Finalize</h3>
                <FinalizeForm
                  executionId={execution.id}
                  version={execution.version}
                  priorities={priorities}
                  severities={severities}
                />
              </>
            ) : (
              <>
                <h3>Finalized</h3>
                <p style={{ marginBottom: "var(--sp-3)" }}>
                  {execution.actualResult || "No actual result was recorded."}
                </p>
                {execution.blockReason ? (
                  <p className="why">
                    <strong>Blocked:</strong> {execution.blockReason}
                  </p>
                ) : null}
                <p className="muted" style={{ margin: 0 }}>
                  This run is closed and cannot be edited. A rerun creates a new execution against
                  the same approved test case.
                </p>
              </>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}
