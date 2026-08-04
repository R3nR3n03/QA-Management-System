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
            <ul className="row-list">
              {unlinked.rows.map((requirement) => (
                <li key={requirement.id} className="list-row">
                  <span className="bid">{requirement.businessId}</span>
                  <span className="row-main" style={{ color: "var(--ink-2)" }}>
                    {requirement.statement}
                  </span>
                </li>
              ))}
            </ul>
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
          <ul className="row-list">
            {links.rows.map((link) => (
              /* Three bare business IDs separated by arrows say nothing about which is
                 the requirement, the case or the defect — and the arrow is a glyph a
                 screen reader either reads as "right arrow" or skips, leaving three
                 unrelated IDs in a row. Knowing what traces to what IS the RTM, so each
                 ID carries its kind as sr-only text and the arrows go decorative, the
                 same treatment `.crumbs span[aria-hidden]` already gets. */
              <li key={link.id} className="list-row">
                <span className="bid">
                  <span className="sr-only">Requirement </span>
                  {link.requirement.businessId}
                </span>
                <span className="muted" aria-hidden="true">
                  →
                </span>
                <span className="bid">
                  <span className="sr-only">covered by test case </span>
                  {link.testCase.businessId}
                </span>
                {link.defect ? (
                  <>
                    <span className="muted" aria-hidden="true">
                      →
                    </span>
                    <span className="bid">
                      <span className="sr-only">which raised defect </span>
                      {link.defect.businessId}
                    </span>
                  </>
                ) : null}
                <span className="row-main" style={{ color: "var(--ink-2)" }}>
                  {link.testCase.title}
                </span>
              </li>
            ))}
          </ul>
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
