import Link from "next/link";
import { notFound } from "next/navigation";
import { DefectLifecycleState, JiraDefectAction, JiraSyncOutcome, QamsRole } from "@prisma/client";
import { listControlledValues } from "@/domain/admin";
import { defectDetail } from "@/domain/defects";
import { listAssignableTesters } from "@/domain/executions";
import { CATALOGUE_PRIORITY, CATALOGUE_SEVERITY } from "@/lib/controlled-value-catalogues";
import { jiraConnectionStatus, jiraIssueUrl } from "@/lib/jira-config";
import { DefectStatusChip } from "@/ui/chips";
import { Breadcrumbs } from "@/ui/breadcrumbs";
import { requireSession } from "@/ui/session";
import { DefectEditForm, TransitionForm } from "./DefectForms";

export const dynamic = "force-dynamic";

/**
 * One defect, with the transitions valid from its current status
 * (`docs/roles-workflows.md:43-49`). Advancing past Triaged is a Senior/Lead call,
 * so those forms only render for them — and the domain refuses anyone else anyway.
 */
export default async function DefectPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  const { id } = await params;

  const defect = await defectDetail(id);
  if (!defect) notFound();

  const [controlled, owners] = await Promise.all([listControlledValues(), listAssignableTesters()]);
  const active = (catalogue: string) =>
    controlled.filter((v) => v.catalogue === catalogue && v.active).map((v) => v.value);

  const mayAdvance = auth.role === QamsRole.SENIOR_QA_ENGINEER || auth.role === QamsRole.QA_LEAD;
  const status = defect.status;

  /**
   * What QAMS has managed to do about this defect in Jira.
   *
   * `jiraIssueHref` is null in the two cases that both render plain text — no Jira configured,
   * or no issue raised — the same shape the run screen uses.
   */
  const jira = jiraConnectionStatus();
  const jiraIssueHref = jiraIssueUrl(jira.baseUrl, defect.jiraIssueKey);
  /** Does this defect's product raise bugs at all? Set in the Catalogue, on the product. */
  const jiraExpected = defect.testCase.product.jiraProjectKey !== null;
  const attemptFor = (action: JiraDefectAction) =>
    defect.jiraAttempts.find((attempt) => attempt.action === action) ?? null;
  const createAttempt = attemptFor(JiraDefectAction.CREATE);
  const commentAttempt = attemptFor(JiraDefectAction.COMMENT);
  const transitionAttempt = attemptFor(JiraDefectAction.TRANSITION);

  return (
    <>
      <Breadcrumbs trail={[{ href: "/defects", label: "Defects" }]} here={defect.businessId} />
      <div className="cluster">
        <span className="bid" style={{ fontSize: 15 }}>{defect.businessId}</span>
        <DefectStatusChip status={status} />
      </div>
      <h1 style={{ marginTop: "var(--sp-2)" }}>{defect.summary}</h1>
      <p className="muted">
        Against{" "}
        <Link href={`/test-cases/${defect.testCase.id}`}>
          <span className="bid">{defect.testCase.businessId}</span> {defect.testCase.title}
        </Link>
        {" · "}
        {defect.priority || "no"} priority · {defect.severity || "no"} severity · version {defect.version}
        {defect.jiraIssueKey ? (
          <>
            {" · Tracked as "}
            {/* "Tracked as BUG-12" rather than a bare key: in a line of facts a bare
                identifier could be read as another QAMS business ID, and this one names a row
                in someone else's database. */}
            {jiraIssueHref ? (
              <a
                className="jira-key"
                href={jiraIssueHref}
                target="_blank"
                /* Not optional with `target="_blank"`: without it the opened page gets a
                   `window.opener` handle back into this one. */
                rel="noopener noreferrer"
                aria-label={`${defect.jiraIssueKey} in Jira, opens in a new tab`}
              >
                {defect.jiraIssueKey}
              </a>
            ) : (
              /* An issue raised while the integration was on, read now that it is off. Still
                 a fact of the defect, with nowhere to send the reader. */
              <span className="jira-key">{defect.jiraIssueKey}</span>
            )}
            {/* Whether the last lifecycle comment reached Jira. Nothing renders without an
                attempt row, which covers every "we never tried" case at once — a defect that
                has not moved since it was raised has nothing to have narrated yet, and
                absence must never read as a failure. Nothing retries a comment, so this line
                is the whole recovery story. */}
            {commentAttempt && commentAttempt.outcome !== JiraSyncOutcome.SUCCEEDED ? (
              <span className="muted-warn">
                {" · Last update not posted to Jira"}
                {commentAttempt.failureReason ? `: ${commentAttempt.failureReason}` : ""}
              </span>
            ) : null}
            {/* Whether the ISSUE moved, which is the half a reader actually asks about once a
                defect is closed. SKIPPED reads as neutral rather than as a warning: QAMS was
                working correctly and chose not to transition, and the reason says why. */}
            {transitionAttempt ? (
              transitionAttempt.outcome === JiraSyncOutcome.SUCCEEDED ? (
                <span className="muted"> · Issue transitioned to Done</span>
              ) : transitionAttempt.outcome === JiraSyncOutcome.SKIPPED ? (
                <span className="muted">
                  {" · Issue not transitioned"}
                  {transitionAttempt.failureReason ? `: ${transitionAttempt.failureReason}` : ""}
                </span>
              ) : (
                <span className="muted-warn">
                  {" · Issue could not be transitioned"}
                  {transitionAttempt.failureReason ? `: ${transitionAttempt.failureReason}` : ""}
                </span>
              )
            ) : null}
          </>
        ) : createAttempt ? (
          /* No issue, and an attempt row explaining why. This is the line that matters most on
             the whole screen: a defect nobody raised in Jira is invisible to every developer
             who works from the board, and until this existed the only evidence was a row in
             JiraDefectAttempt. ABANDONED is called out separately because it is terminal —
             nothing will retry it, and a person has to act. */
          <span className="muted-warn">
            {createAttempt.outcome === JiraSyncOutcome.ABANDONED
              ? " · Not raised in Jira, and no longer being retried"
              : " · Not yet raised in Jira"}
            {createAttempt.failureReason ? `: ${createAttempt.failureReason}` : ""}
          </span>
        ) : jira.connected && jiraExpected ? (
          /* This product raises bugs, but nothing was ever attempted for this defect — it
             predates the project being named on the product. Not a fault.

             Gated on the PRODUCT's project key, not just on Jira being connected: a product
             with no key was never meant to raise anything, and saying "no Jira issue" on
             every one of its defects would report configuration as though it were a gap. */
          " · No Jira issue"
        ) : null}
      </p>

      {defect.resolutionSummary ? (
        <div className="card" style={{ marginBottom: "var(--sp-4)" }}>
          <h3>Resolution</h3>
          <p style={{ marginBottom: 0 }}>{defect.resolutionSummary}</p>
        </div>
      ) : null}
      {defect.closureRationale || defect.retestEvidenceRef ? (
        <div className="card" style={{ marginBottom: "var(--sp-4)" }}>
          <h3>Closure</h3>
          {defect.retestEvidenceRef ? (
            <p>
              Retest evidence: <span className="bid">{defect.retestEvidenceRef}</span>
            </p>
          ) : null}
          {defect.closureRationale ? <p style={{ marginBottom: 0 }}>{defect.closureRationale}</p> : null}
        </div>
      ) : null}

      {status === DefectLifecycleState.NEW ? (
        <>
          <h2>Details</h2>
          <div className="card" style={{ marginBottom: "var(--sp-5)" }}>
            <DefectEditForm
              defect={{
                id: defect.id,
                version: defect.version,
                summary: defect.summary,
                priority: defect.priority,
                severity: defect.severity
              }}
              priorities={active(CATALOGUE_PRIORITY)}
              severities={active(CATALOGUE_SEVERITY)}
            />
          </div>
          <h2>Triage</h2>
          <div className="card" style={{ marginBottom: "var(--sp-5)" }}>
            <p className="muted">Triage confirms priority and severity are set and valid.</p>
            <TransitionForm defect={defect} target="TRIAGED" label="Mark Triaged" />
          </div>
        </>
      ) : null}

      {status === DefectLifecycleState.TRIAGED && mayAdvance ? (
        <>
          <h2>Start investigation</h2>
          <div className="card" style={{ marginBottom: "var(--sp-5)" }}>
            <TransitionForm
              defect={defect}
              target="IN_PROGRESS"
              label="Move to In Progress"
              owners={owners.map((o) => ({ id: o.id, displayName: o.displayName }))}
            />
          </div>
        </>
      ) : null}

      {status === DefectLifecycleState.IN_PROGRESS && mayAdvance ? (
        <>
          <h2>Resolve</h2>
          <div className="card" style={{ marginBottom: "var(--sp-5)" }}>
            <TransitionForm defect={defect} target="RESOLVED" label="Mark Resolved" />
          </div>
        </>
      ) : null}

      {status === DefectLifecycleState.RESOLVED && mayAdvance ? (
        <>
          <h2>Close</h2>
          <div className="card" style={{ marginBottom: "var(--sp-5)" }}>
            <TransitionForm defect={defect} target="CLOSED" label="Close defect" />
          </div>
          <h2>Reopen</h2>
          <div className="card" style={{ marginBottom: "var(--sp-5)" }}>
            <TransitionForm defect={defect} target="REOPEN" label="Reopen to In Progress" />
          </div>
        </>
      ) : null}

      {status === DefectLifecycleState.CLOSED ? (
        <p className="muted">Closed is final — a recurrence is a new defect referencing the same test case.</p>
      ) : null}
    </>
  );
}
