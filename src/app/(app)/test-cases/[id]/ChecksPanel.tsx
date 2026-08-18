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
 */
export async function ChecksPanel({
  testCaseId,
  stampFormat
}: {
  testCaseId: string;
  stampFormat: StampFormat;
}) {
  const { checks, total } = await listChecksForTestCase(testCaseId);
  const omitted = total - checks.length;

  return (
    <>
      <h2>Automation checks</h2>
      <div className="card card-flush" style={{ marginBottom: "var(--sp-6)" }}>
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
            <ul className="row-list">
              {checks.map((check) => (
                <li key={check.id} className="list-row">
                  <span className="row-main">
                    <span>{check.testName}</span>
                    <span className="muted"> · {check.specName}</span>
                    {check.failureReason ? (
                      <>
                        <br />
                        <span className="hint">{check.failureReason}</span>
                      </>
                    ) : null}
                  </span>
                  <span className="muted">
                    <time dateTime={check.checkedAt.toISOString()}>
                      {formatMinute(check.checkedAt, stampFormat)}
                    </time>
                  </span>
                  <CheckOutcomeChip outcome={check.outcome} />
                </li>
              ))}
            </ul>
            {/* Never a silently truncated list. A reader who is not told would take these
                for the whole history — the same rule a Jira result comment follows when it
                caps the cases it lists. */}
            <p className="hint" style={{ padding: "var(--sp-3) var(--sp-4)" }}>
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
