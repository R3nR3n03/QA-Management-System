import Link from "next/link";
import { notFound } from "next/navigation";
import { DefectLifecycleState, QamsRole } from "@prisma/client";
import { listControlledValues } from "@/domain/admin";
import { defectDetail } from "@/domain/defects";
import { listAssignableTesters } from "@/domain/executions";
import { CATALOGUE_PRIORITY, CATALOGUE_SEVERITY } from "@/lib/controlled-value-catalogues";
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

  return (
    <>
      <Breadcrumbs trail={[{ href: "/defects", label: "Defects" }]} here={defect.businessId} />
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", flexWrap: "wrap" }}>
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
