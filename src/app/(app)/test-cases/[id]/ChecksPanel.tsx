import Link from "next/link";
import type { Check } from "@prisma/client";
import { listChecksForTestCase, TEST_CASE_CHECK_LIMIT } from "@/domain/checks";
import { CheckOutcomeChip } from "@/ui/chips";
import { formatMinute, type StampFormat } from "@/ui/format";

/**
 * What automation has observed about this test case.
 *
 * Deliberately its own section, never interleaved with execution history. A check reports
 * what a spec saw; an execution records what a person claimed, and a reader must always be
 * able to tell which of the two they are looking at (ADR-0008).
 *
 * The panel is shown to every role that may view the case: reading a check is not a separate
 * capability, it follows the right to view what it references.
 *
 * ## Why the rows are grouped by run, and why the answer is a RUN and not a check
 *
 * Ingestion stamps a single `checkedAt` for a whole file, deliberately — "every test in a
 * results file belongs to one run, and stamping them individually would invent an ordering the
 * file never claimed". The panel was printing that one instant on every row, repeating it
 * twenty times while still never saying that six of them were one run. The grouping is free: it
 * is what the data already says.
 *
 * `docs/architecture.md` states the panel's whole job in its own words — "answer, on a test
 * case's screen, 'what did automation last see here?'" — and it used to answer that by listing
 * up to twenty checks newest-first and leaving a reader to work out that row one was the
 * answer, while rows two to twenty looked exactly as important.
 *
 * The answer is therefore the first GROUP, labelled "Latest run", and NOT a single check lifted
 * out of it. A case checked by two specs in one file has two checks at one instant, so "the
 * most recent check" is decided by nothing — `orderBy` falls through to `createdAt`, which one
 * `createMany` writes identically. Elevating either one would present an arbitrary pick as what
 * automation last saw, which is the one way this panel can state something untrue.
 */
export async function ChecksPanel({
  testCaseId,
  stampFormat,
  canOpenBatch = false
}: {
  testCaseId: string;
  stampFormat: StampFormat;
  /**
   * Whether this viewer may open the batch a check came from.
   *
   * The panel is shown to every role that may view the case, but a batch report names
   * every spec and test in another team’s repository and sits under Administration
   * (`docs/api-and-security.md`), so `/admin/checks/[id]` 404s for everyone else. An
   * affordance appears only where it works: without this the most obvious click on a
   * failing check would be a dead end for most of the people who would make it.
   */
  canOpenBatch?: boolean;
}) {
  const { checks, total } = await listChecksForTestCase(testCaseId);
  const omitted = total - checks.length;
  const runs = groupByRun(checks);

  return (
    <>
      <h2>Automation checks</h2>
      {/* No bottom margin of its own: the panel is the last section of the record's column, and
          the rhythm between sections belongs to `.case-body`. */}
      <div className="card card-flush">
        {checks.length === 0 ? (
          <div className="empty">
            <p>
              No automation has reported on this test case. QAMS holds no link between a case and
              a spec, so this says only that no results naming{" "}
              <span className="bid">this case</span> have been ingested — not that none exist.
            </p>
          </div>
        ) : (
          <>
            {runs.map((run, index) => (
              <div key={run.key}>
                {/* "Latest run" is the whole answer to "what did automation last see here?",
                    and it names a RUN because that is the granularity the data has — see the
                    note at the top on why no single check is lifted out of it.

                    One file is one link, and it lives on the run rather than on every check in
                    it — where it was repeated per row. Only for a viewer who may open it. */}
                <p className="check-run">
                  <b>{index === 0 ? "Latest run" : "Earlier run"}</b>
                  <span>
                    <time dateTime={run.checkedAt.toISOString()}>
                      {formatMinute(run.checkedAt, stampFormat)}
                    </time>
                    {" · "}
                    {run.checks.length} {run.checks.length === 1 ? "check" : "checks"}
                    {canOpenBatch ? (
                      <>
                        {" · "}
                        <Link href={`/admin/checks/${run.checkBatchId}`}>results file</Link>
                      </>
                    ) : null}
                  </span>
                </p>
                <ul className="row-list">
                  {run.checks.map((check) => (
                    <li key={check.id} className="list-row">
                      <span className="row-main">
                        <span className="check-test">{check.testName}</span>
                        {/* The runner's message on its own line, in mono. It was a `<br>` and a
                            `.hint` inside `.row-main`, so it wrapped under the test name at
                            whatever width happened to be left. */}
                        {check.failureReason ? (
                          <span className="check-said">{check.failureReason}</span>
                        ) : null}
                      </span>
                      <span className="muted">{check.specName}</span>
                      <CheckOutcomeChip outcome={check.outcome} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            {/* Never a silently truncated list. A reader who is not told would take these
                for the whole history — the same rule a Jira result comment follows when it
                caps the cases it lists. `docs/architecture.md` requires the omission be
                stated, so this sentence is not optional. */}
            <p className="hint" style={{ padding: "var(--sp-3) var(--sp-5)" }}>
              {omitted > 0
                ? `Showing the ${TEST_CASE_CHECK_LIMIT} most recent of ${total} checks; ${omitted} older ${omitted === 1 ? "check is" : "checks are"} not listed.`
                : `${total} ${total === 1 ? "check" : "checks"}, newest first.`}
            </p>
          </>
        )}
      </div>
    </>
  );
}

type Run = {
  key: string;
  checkBatchId: string;
  checkedAt: Date;
  checks: Check[];
};

/**
 * The checks split into the runs that produced them, newest run first.
 *
 * Keyed by batch AND instant rather than by batch alone: two files ingested in the same second
 * are two runs, and one file cannot carry two instants (ingestion stamps it once), so the pair
 * is the honest identity. A single pass over an already-sorted list, so the order inside each
 * run is the order `listChecksForTestCase` returned — newest first, as the copy claims.
 */
function groupByRun(checks: Check[]): Run[] {
  const runs: Run[] = [];
  for (const check of checks) {
    const key = `${check.checkBatchId}:${check.checkedAt.toISOString()}`;
    const open = runs[runs.length - 1];
    if (open && open.key === key) open.checks.push(check);
    else
      runs.push({
        key,
        checkBatchId: check.checkBatchId,
        checkedAt: check.checkedAt,
        checks: [check]
      });
  }
  return runs;
}
