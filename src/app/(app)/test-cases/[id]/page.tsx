import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText } from "lucide-react";
import { QamsRole, TestCaseLifecycleState } from "@prisma/client";
import { listControlledValues } from "@/domain/admin";
import { profile } from "@/domain/auth";
import { getTestCase } from "@/domain/test-cases";
import { CATALOGUE_PRIORITY, CATALOGUE_SEVERITY } from "@/lib/controlled-value-catalogues";
import { AppError } from "@/lib/errors";
import { TEST_CASE_STATE_LABEL, TestCaseStateChip } from "@/ui/chips";
import { Breadcrumbs } from "@/ui/breadcrumbs";
import { formatMinute, viewerStampFormat } from "@/ui/format";
import { requireSession } from "@/ui/session";
import { Stepper } from "@/ui/stepper";
import { ChecksPanel } from "./ChecksPanel";
import { DraftEditForm, LifecycleButton, RetireForm, ReturnToDraftForm, StepsEditor } from "./CaseForms";

export const dynamic = "force-dynamic";

/**
 * The states a case moves through, in the order `docs/roles-workflows.md` § "Test-case
 * lifecycle" transitions them.
 *
 * `Retired` is NOT in this list. Retiring is optional there — "retiring the prior revision is
 * optional and must not break historical references" — so a pending fourth step beside an
 * Approved case would present an optional end as the expected next one, which is a claim the
 * documents do not make. It is appended only once the case has actually been retired, and that
 * state is terminal, so a rail that grows once never shrinks again.
 *
 * Words come from `TEST_CASE_STATE_LABEL`, which is what the chip beside the rail reads too:
 * restating them here would be four chances for the two to disagree.
 */
const LIFECYCLE_RAIL: readonly TestCaseLifecycleState[] = [
  TestCaseLifecycleState.DRAFT,
  TestCaseLifecycleState.IN_REVIEW,
  TestCaseLifecycleState.APPROVED
];

/**
 * One test case, with exactly the actions its state and the viewer's role allow.
 * Hiding a form here is presentation; the refusal that matters lives in
 * `src/domain/test-cases.ts` and fires for any caller.
 *
 * ## The shape of the screen
 *
 * The record on the left, the attributes it was filed under in the rail on the right
 * (`.detail-cols`), with the identity, the lifecycle and any band that qualifies the whole
 * record above both. It was a single 1040px column of stacked cards under one muted run-on
 * line — "Authored by Priya Raman · Q3 / S12 / 2026.4 · staging · High priority · Major
 * severity · version 3" — which is nine facts a reader has to parse as a sentence to answer a
 * question as small as "which sprint?".
 *
 * The screen takes the 1440px opt-in (`.shell-main:has(.case-screen)`) and spends it on that
 * second column rather than on wider prose, the way `/account` does. It deliberately does not
 * follow the LIST screen, which is uncapped: a table of five columns reads better the more room
 * it has, and an objective is a paragraph.
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
  const stampFormat = viewerStampFormat(auth);
  const retired = state === TestCaseLifecycleState.RETIRED;
  const rail = retired ? [...LIFECYCLE_RAIL, state] : LIFECYCLE_RAIL;

  return (
    <div className="case-screen">
      <Breadcrumbs trail={[{ href: "/test-cases", label: "Test cases" }]} here={testCase.businessId} />

      {/* The record's identity is its business ID — the thing people quote, search and compare —
          so that is the h1, with the chip that qualifies it beside it, and the title is the line
          under it. Exactly the shape the execution detail screen uses (`.run-id`, `.run-lede`):
          those two classes mean "a business ID as the heading" and "what the record is", not
          anything run-specific — the same reading `.check-file-id`'s note relies on. */}
      <div className="page-head">
        <div className="cluster">
          <h1 className="run-id">{testCase.businessId}</h1>
          <TestCaseStateChip state={state} />
        </div>
      </div>
      <p className="run-lede">{testCase.title}</p>

      {/* Where the case has got to, as context rather than as the headline — which is what the
          `bar` variant is for ("the stage is context on a screen whose subject is something
          else"). No timestamps: the record keeps `createdAt` and `updatedAt`, and neither is the
          moment a transition happened, so a hint here would date the wrong event. */}
      <Stepper
        steps={rail.map((value) => ({ key: value, label: TEST_CASE_STATE_LABEL[value] }))}
        currentIndex={rail.indexOf(state)}
        label="Test case lifecycle"
      />

      {/* Screen-level, above the columns: both qualify the whole record, not one section of it. */}
      {testCase.reviewReason && state === TestCaseLifecycleState.DRAFT ? (
        <p className="why">
          <strong>Returned from review.</strong> {testCase.reviewReason}
        </p>
      ) : null}
      {testCase.retirementReason ? (
        <p className="why">
          <strong>Retired.</strong> {testCase.retirementReason}
        </p>
      ) : null}

      <div className="detail-cols">
        <div className="case-body">
          {/* A matched pair — what the case sets out to prove, and what would prove it — so they
              read side by side and each gets a measure, rather than two paragraphs stacked at the
              full width of the column (`.case-pair`). */}
          <section className="card case-pair">
            <div>
              <h3>Objective</h3>
              <p>{testCase.objective}</p>
            </div>
            <div>
              <h3>Expected result</h3>
              <p>{testCase.expectedResult}</p>
            </div>
          </section>

          <section>
            <h2>Steps</h2>
            {state === TestCaseLifecycleState.DRAFT && mayAuthor ? (
              <div className="card">
                <StepsEditor
                  testCaseId={testCase.id}
                  version={testCase.version}
                  steps={testCase.steps.map((s) => ({ action: s.action, expectedResult: s.expectedResult }))}
                />
              </div>
            ) : (
              <div className="card card-flush">
                {testCase.steps.length === 0 ? (
                  <div className="empty">
                    <p>No steps yet.</p>
                  </div>
                ) : (
                  /* A `.data-table`, where this was a `.list-row` holding two unlabelled
                     `.row-main`s. Two columns of prose with no headings: nothing on screen said
                     which half was the instruction and which was what it should produce, and a
                     reader had to infer it from the first row that happened to be phrased like
                     an expectation. The words belong in the `<th>`s. */
                  <div className="table-scroll">
                    <table className="data-table">
                      {/* Without a name this announces as an unnamed table in a screen
                          reader's table list. */}
                      <caption className="sr-only">Test steps in order</caption>
                      <thead>
                        <tr>
                          <th scope="col" className="num">
                            #
                          </th>
                          <th scope="col">Action</th>
                          <th scope="col">Expected result</th>
                        </tr>
                      </thead>
                      <tbody>
                        {testCase.steps.map((step) => (
                          <tr key={step.id}>
                            <td className="num muted">{step.sequence}</td>
                            <td>{step.action}</td>
                            <td>{step.expectedResult}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </section>

          {state === TestCaseLifecycleState.DRAFT && mayAuthor ? (
            <>
              <section>
                <h2>Edit draft</h2>
                <div className="card">
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
              </section>

              <section>
                <h2>Submit for review</h2>
                <div className="card">
                  <LifecycleButton
                    testCaseId={testCase.id}
                    version={testCase.version}
                    kind="submit"
                    label="Submit for review"
                    warning="Submitting locks the draft: only a reviewer can return it for further edits."
                  />
                </div>
              </section>
            </>
          ) : null}

          {state === TestCaseLifecycleState.IN_REVIEW && mayReview ? (
            <section>
              <h2>Review</h2>
              <div className="card">
                {isAuthor ? (
                  <p className="why">
                    <strong>You authored this case.</strong> An author cannot approve their own work
                    — another reviewer has to make this call.
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
                {/* The two halves of a review decision are separated by a rule rather than by a
                    second card: sending it back is the same decision as approving it, taken the
                    other way. */}
                <div className="review-alt">
                  <ReturnToDraftForm testCaseId={testCase.id} version={testCase.version} />
                </div>
              </div>
            </section>
          ) : null}

          {state === TestCaseLifecycleState.APPROVED ? (
            <section>
              <h2>Approved case</h2>
              <div className="card">
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
            </section>
          ) : null}

          <section>
            <ChecksPanel
              testCaseId={testCase.id}
              stampFormat={stampFormat}
              canOpenBatch={auth.role === QamsRole.QA_LEAD}
            />
          </section>
        </div>

        {/*
         * The attributes the case was filed under, grouped by the same headings the create form
         * asks its questions under ("Planning", "Classification") — so the record reads back in
         * the order it was filled in. Provenance is the third group because it is the only one
         * nobody typed: the system recorded it.
         */}
        <aside className="card case-aside">
          <div className="panel-head">
            <span className="medallion" aria-hidden>
              <FileText size={19} strokeWidth={1.9} aria-hidden />
            </span>
            <div className="panel-head-text">
              <h2>Case details</h2>
              <p>What this case was filed under.</p>
            </div>
          </div>

          <h3>Classification</h3>
          <dl className="fact-grid">
            <div>
              <dt>Priority</dt>
              <dd>{testCase.priority}</dd>
            </div>
            <div>
              <dt>Severity</dt>
              <dd>{testCase.severity}</dd>
            </div>
          </dl>

          {/* Cycle, sprint, release and environment are required free-text attributes with no
              master entity of their own (`docs/data-model.md`), so they are values here and
              never links into a catalogue that does not exist. */}
          <h3>Planning</h3>
          <dl className="fact-grid">
            <div>
              <dt>Cycle</dt>
              <dd>{testCase.cycle}</dd>
            </div>
            <div>
              <dt>Sprint</dt>
              <dd>{testCase.sprint}</dd>
            </div>
            <div>
              <dt>Release</dt>
              <dd>{testCase.release}</dd>
            </div>
            <div>
              <dt>Environment</dt>
              <dd>{testCase.environment}</dd>
            </div>
          </dl>

          <h3>Provenance</h3>
          <dl className="fact-grid">
            <div>
              <dt>Author</dt>
              <dd>{author?.displayName ?? "unknown"}</dd>
            </div>
            <div>
              {/* The optimistic-concurrency version, which every form on this screen submits
                  and every conflict quotes back. A reader who has just been told their save
                  lost a race needs to be able to see it. */}
              <dt>Version</dt>
              <dd>{testCase.version}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>
                <time dateTime={testCase.createdAt.toISOString()}>
                  {formatMinute(testCase.createdAt, stampFormat)}
                </time>
              </dd>
            </div>
            <div>
              <dt>Last updated</dt>
              <dd>
                <time dateTime={testCase.updatedAt.toISOString()}>
                  {formatMinute(testCase.updatedAt, stampFormat)}
                </time>
              </dd>
            </div>
            {/* Only the link, not the earlier case's business ID: `getTestCase` returns the row
                verbatim to `GET /api/v1/test-cases/{id}`, and widening it to include the revised
                case would change a documented API surface for the sake of a label. The
                destination says which case it was. */}
            {testCase.revisesTestCaseId ? (
              <div>
                <dt>Revises</dt>
                <dd>
                  <Link href={`/test-cases/${testCase.revisesTestCaseId}`}>the earlier revision</Link>
                </dd>
              </div>
            ) : null}
          </dl>
        </aside>
      </div>
    </div>
  );
}
