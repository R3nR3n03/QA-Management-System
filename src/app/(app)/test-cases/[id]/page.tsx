import Link from "next/link";
import { notFound } from "next/navigation";
import { QamsRole, TestCaseLifecycleState } from "@prisma/client";
import { listControlledValues } from "@/domain/admin";
import { profile } from "@/domain/auth";
import { getTestCase } from "@/domain/test-cases";
import { CATALOGUE_PRIORITY, CATALOGUE_SEVERITY } from "@/lib/controlled-value-catalogues";
import { AppError } from "@/lib/errors";
import { TestCaseStateChip } from "@/ui/chips";
import { requireSession } from "@/ui/session";
import { DraftEditForm, LifecycleButton, RetireForm, ReturnToDraftForm, StepsEditor } from "./CaseForms";

export const dynamic = "force-dynamic";

/**
 * One test case, with exactly the actions its state and the viewer's role allow.
 * Hiding a form here is presentation; the refusal that matters lives in
 * `src/domain/test-cases.ts` and fires for any caller.
 */
export default async function TestCasePage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  const { id } = await params;

  let testCase;
  try {
    testCase = await getTestCase(id);
  } catch (error) {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  }

  const [author, controlled] = await Promise.all([
    profile(testCase.authorUserId),
    listControlledValues()
  ]);
  const active = (catalogue: string) =>
    controlled.filter((v) => v.catalogue === catalogue && v.active).map((v) => v.value);

  const isAuthor = testCase.authorUserId === auth.userId;
  const mayAuthor = auth.role !== QamsRole.QA_TESTER;
  const mayReview = auth.role === QamsRole.SENIOR_QA_ENGINEER || auth.role === QamsRole.QA_LEAD;
  const state = testCase.lifecycleState;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", flexWrap: "wrap" }}>
        <span className="bid" style={{ fontSize: 15 }}>{testCase.businessId}</span>
        <TestCaseStateChip state={state} />
      </div>
      <h1 style={{ marginTop: "var(--sp-2)" }}>{testCase.title}</h1>
      <p className="muted">
        Authored by {author?.displayName ?? "unknown"} · {testCase.cycle} / {testCase.sprint} /{" "}
        {testCase.release} · {testCase.environment} · {testCase.priority} priority ·{" "}
        {testCase.severity} severity · version {testCase.version}
      </p>

      {testCase.reviewReason && state === TestCaseLifecycleState.DRAFT ? (
        <p className="why" style={{ marginBottom: "var(--sp-4)" }}>
          <strong>Returned from review.</strong> {testCase.reviewReason}
        </p>
      ) : null}
      {testCase.retirementReason ? (
        <p className="why" style={{ marginBottom: "var(--sp-4)" }}>
          <strong>Retired.</strong> {testCase.retirementReason}
        </p>
      ) : null}

      <div className="card" style={{ marginBottom: "var(--sp-5)" }}>
        <h3>Objective</h3>
        <p>{testCase.objective}</p>
        <h3>Expected result</h3>
        <p style={{ marginBottom: 0 }}>{testCase.expectedResult}</p>
      </div>

      <h2>Steps</h2>
      {state === TestCaseLifecycleState.DRAFT && mayAuthor ? (
        <div className="card" style={{ marginBottom: "var(--sp-5)" }}>
          <StepsEditor
            testCaseId={testCase.id}
            version={testCase.version}
            steps={testCase.steps.map((s) => ({ action: s.action, expectedResult: s.expectedResult }))}
          />
        </div>
      ) : (
        <div className="card" style={{ padding: 0, marginBottom: "var(--sp-5)" }}>
          {testCase.steps.length === 0 ? (
            <p className="muted" style={{ padding: "var(--sp-4) var(--sp-5)", margin: 0 }}>
              No steps yet.
            </p>
          ) : (
            testCase.steps.map((step) => (
              <div
                key={step.id}
                style={{ display: "flex", gap: "var(--sp-4)", padding: "var(--sp-3) var(--sp-5)", borderBottom: "1px solid var(--line-soft)" }}
              >
                <span className="bid" style={{ minWidth: 20, textAlign: "right" }}>{step.sequence}</span>
                <div style={{ flex: 1 }}>{step.action}</div>
                <div style={{ flex: 1, color: "var(--ink-2)" }}>{step.expectedResult}</div>
              </div>
            ))
          )}
        </div>
      )}

      {state === TestCaseLifecycleState.DRAFT && mayAuthor ? (
        <>
          <h2>Edit draft</h2>
          <div className="card" style={{ marginBottom: "var(--sp-5)" }}>
            <DraftEditForm
              testCase={{
                id: testCase.id,
                version: testCase.version,
                cycle: testCase.cycle,
                sprint: testCase.sprint,
                release: testCase.release,
                environment: testCase.environment,
                priority: testCase.priority,
                severity: testCase.severity,
                title: testCase.title,
                objective: testCase.objective,
                expectedResult: testCase.expectedResult
              }}
              priorities={active(CATALOGUE_PRIORITY)}
              severities={active(CATALOGUE_SEVERITY)}
            />
          </div>

          <h2>Submit for review</h2>
          <div className="card" style={{ marginBottom: "var(--sp-5)" }}>
            <LifecycleButton
              testCaseId={testCase.id}
              version={testCase.version}
              kind="submit"
              label="Submit for review"
              warning="Submitting locks the draft: only a reviewer can return it for further edits."
            />
          </div>
        </>
      ) : null}

      {state === TestCaseLifecycleState.IN_REVIEW && mayReview ? (
        <>
          <h2>Review</h2>
          <div className="card" style={{ marginBottom: "var(--sp-5)" }}>
            {isAuthor ? (
              <p className="why">
                <strong>You authored this case.</strong> An author cannot approve their own work —
                another reviewer has to make this call.
              </p>
            ) : (
              <LifecycleButton
                testCaseId={testCase.id}
                version={testCase.version}
                kind="approve"
                label="Approve"
                warning="Approving confirms design completeness. Approved content is immutable — later changes need a new revision."
              />
            )}
            <div style={{ marginTop: "var(--sp-4)", borderTop: "1px solid var(--line-soft)", paddingTop: "var(--sp-4)" }}>
              <ReturnToDraftForm testCaseId={testCase.id} version={testCase.version} />
            </div>
          </div>
        </>
      ) : null}

      {state === TestCaseLifecycleState.APPROVED ? (
        <>
          <h2>Approved case</h2>
          <div className="card" style={{ marginBottom: "var(--sp-5)" }}>
            <p>
              Approved content is immutable. To change it,{" "}
              {mayAuthor ? (
                <Link href={`/test-cases/new?revises=${testCase.id}`}>start a new revision</Link>
              ) : (
                "an author starts a new revision"
              )}
              ; to stop it counting as active, a reviewer retires it below.
            </p>
            {mayReview ? <RetireForm testCaseId={testCase.id} version={testCase.version} /> : null}
          </div>
        </>
      ) : null}
    </>
  );
}
