import { JiraSyncOutcome } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { resolveDisconnectDisposition, type PendingSync } from "./jira-credentials";

const pending = (issueKey: string): PendingSync => ({
  jiraIssueKey: issueKey,
  executionId: `exec-${issueKey}`
});

describe("resolveDisconnectDisposition", () => {
  // Q6: a person who disconnects has withdrawn consent. Replaying their queued work as them
  // afterwards is exactly what consent existed to prevent.
  it("hands queued work to the service account when one is configured", () => {
    const disposition = resolveDisconnectDisposition([pending("PROJ-1")], true);
    expect(disposition.abandoned).toEqual([]);
    expect(disposition.retryAsServiceAccount).toHaveLength(1);
  });

  it("abandons queued work when no service account is configured", () => {
    const disposition = resolveDisconnectDisposition([pending("PROJ-1")], false);
    expect(disposition.retryAsServiceAccount).toEqual([]);
    expect(disposition.abandoned).toHaveLength(1);
    expect(disposition.abandoned[0].outcome).toBe(JiraSyncOutcome.ABANDONED);
  });

  it("says why it was abandoned, for the QA Lead reading the failure list", () => {
    const [row] = resolveDisconnectDisposition([pending("PROJ-1")], false).abandoned;
    expect(row.failureReason).toMatch(/disconnect/i);
  });

  // Abandonment is a NEW append-only row, never an edit of the attempt that failed
  // (`docs/data-model.md` — sync attempts are append-only).
  it("carries the execution and issue key onto the abandonment row", () => {
    const [row] = resolveDisconnectDisposition([pending("PROJ-9")], false).abandoned;
    expect(row.jiraIssueKey).toBe("PROJ-9");
    expect(row.executionId).toBe("exec-PROJ-9");
  });

  // The abandonment was not performed by the person who disconnected — it is a system
  // decision, and attributing it to them would misreport who acted.
  it("attributes the abandonment to no user", () => {
    const [row] = resolveDisconnectDisposition([pending("PROJ-1")], false).abandoned;
    expect(row.actorId).toBeNull();
  });

  it("does nothing when the person had no queued work", () => {
    const disposition = resolveDisconnectDisposition([], false);
    expect(disposition.abandoned).toEqual([]);
    expect(disposition.retryAsServiceAccount).toEqual([]);
  });
});
