import { QamsRole } from "@prisma/client";
import {
  listRequirementsWithoutTraceLinks,
  listRtmLinksWithRefs,
  listTraceLinkOptions
} from "@/domain/traceability";
import { readPage, type ListSearchParams } from "@/ui/list-params";
import { Pager } from "@/ui/pager";
import { requireSession } from "@/ui/session";
import { LinkForm } from "./LinkForm";

export const dynamic = "force-dynamic";

/**
 * The requirements traceability matrix: every recorded requirement ↔ test case
 * (↔ defect) link, and the requirements that still have none — the gap list is the
 * point of an RTM.
 *
 * This screen used to read four whole tables (links, requirements, test cases, defects)
 * to build id→businessId maps and subtract one set from another. Both jobs are queries
 * now: the links carry their own joined labels, and the gap list is `rtmLinks: none`.
 * Only the form's pickers stay unpaged, projected to the columns they render.
 */
export default async function TraceabilityPage({
  searchParams
}: {
  searchParams: Promise<ListSearchParams>;
}) {
  const params = await searchParams;
  const auth = await requireSession();
  const mayLink = auth.role !== QamsRole.QA_TESTER;

  const linksPage = readPage(params, "links");
  const unlinkedPage = readPage(params, "unlinked");

  const [links, unlinked, options] = await Promise.all([
    listRtmLinksWithRefs({ page: linksPage }),
    listRequirementsWithoutTraceLinks({ page: unlinkedPage }),
    // Only fetched when the form will actually render.
    mayLink ? listTraceLinkOptions() : Promise.resolve(null)
  ]);

  return (
    <>
      <h1>Traceability</h1>
      <p className="muted" style={{ marginBottom: "var(--sp-4)" }}>
        {links.total} trace link{links.total === 1 ? "" : "s"} · {unlinked.total} requirement
        {unlinked.total === 1 ? "" : "s"} without any link.
      </p>

      {unlinked.total > 0 ? (
        <>
          <h2>Requirements without trace links</h2>
          <div className="card card-flush" style={{ marginBottom: "var(--sp-5)" }}>
            {unlinked.rows.map((requirement) => (
              <div key={requirement.id} className="list-row">
                <span className="bid">{requirement.businessId}</span>
                <span style={{ color: "var(--ink-2)" }}>{requirement.statement}</span>
              </div>
            ))}
            <Pager
              total={unlinked.total}
              page={unlinkedPage}
              pathname="/traceability"
              params={params}
              pageKey="unlinked"
              label="requirements without trace links"
            />
          </div>
        </>
      ) : null}

      <h2>Trace links</h2>
      <div className="card card-flush" style={{ marginBottom: "var(--sp-5)" }}>
        {links.rows.length === 0 ? (
          <div className="empty">
            <p>No trace links yet.</p>
          </div>
        ) : (
          links.rows.map((link) => (
            <div key={link.id} className="list-row">
              <span className="bid">{link.requirement.businessId}</span>
              <span className="muted">→</span>
              <span className="bid">{link.testCase.businessId}</span>
              {link.defect ? (
                <>
                  <span className="muted">→</span>
                  <span className="bid">{link.defect.businessId}</span>
                </>
              ) : null}
              <span className="row-main" style={{ color: "var(--ink-2)" }}>
                {link.testCase.title}
              </span>
            </div>
          ))
        )}
        <Pager
          total={links.total}
          page={linksPage}
          pathname="/traceability"
          params={params}
          pageKey="links"
          label="trace links"
        />
      </div>

      {mayLink && options ? (
        <>
          <h2>New trace link</h2>
          <div className="card">
            <LinkForm
              requirements={options.requirements.map((r) => ({
                id: r.id,
                businessId: r.businessId,
                label: r.statement
              }))}
              cases={options.testCases.map((c) => ({
                id: c.id,
                businessId: c.businessId,
                title: c.title,
                requirementId: c.requirementId
              }))}
              defects={options.defects.map((d) => ({
                id: d.id,
                businessId: d.businessId,
                summary: d.summary,
                testCaseId: d.testCaseId
              }))}
            />
          </div>
        </>
      ) : null}
    </>
  );
}
