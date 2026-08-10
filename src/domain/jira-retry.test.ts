import { describe, expect, it } from "vitest";
import { MAX_SYNC_ATTEMPTS, planRetries, type AttemptSummary } from "./jira-retry";

const a = (jiraIssueKey: string, failures: number): AttemptSummary => ({
  jiraIssueKey,
  executionId: `exec-${jiraIssueKey}`,
  failureCount: failures
});

describe("planRetries", () => {
  it("retries an issue that has failed once", () => {
    const plan = planRetries([a("PROJ-1", 1)]);
    expect(plan.retry.map((r) => r.jiraIssueKey)).toEqual(["PROJ-1"]);
    expect(plan.abandon).toEqual([]);
  });

  it("keeps retrying up to the budget", () => {
    const plan = planRetries([a("PROJ-1", MAX_SYNC_ATTEMPTS - 1)]);
    expect(plan.retry).toHaveLength(1);
    expect(plan.abandon).toEqual([]);
  });

  // A queue that retries forever hides a permanently broken credential. Giving up is what
  // puts it in front of a QA Lead (`docs/architecture.md#Jira execution sync`).
  it("abandons an issue once the budget is spent", () => {
    const plan = planRetries([a("PROJ-1", MAX_SYNC_ATTEMPTS)]);
    expect(plan.retry).toEqual([]);
    expect(plan.abandon).toHaveLength(1);
  });

  it("abandons rather than retries when the budget is exceeded", () => {
    expect(planRetries([a("PROJ-1", MAX_SYNC_ATTEMPTS + 3)]).abandon).toHaveLength(1);
  });

  it("says why it gave up, for the Lead reading the failure list", () => {
    const [row] = planRetries([a("PROJ-1", MAX_SYNC_ATTEMPTS)]).abandon;
    expect(row.failureReason).toMatch(/attempt/i);
    expect(row.jiraIssueKey).toBe("PROJ-1");
    expect(row.executionId).toBe("exec-PROJ-1");
  });

  // Abandoning is a system decision, not a person's — attributing it to the tester whose run
  // happened to trigger the first attempt would misreport who acted.
  it("attributes an abandonment to no user", () => {
    expect(planRetries([a("PROJ-1", MAX_SYNC_ATTEMPTS)]).abandon[0].actorId).toBeNull();
  });

  it("sorts each issue into exactly one bucket", () => {
    const plan = planRetries([a("PROJ-1", 1), a("PROJ-2", MAX_SYNC_ATTEMPTS), a("PROJ-3", 2)]);
    expect(plan.retry.map((r) => r.jiraIssueKey).sort()).toEqual(["PROJ-1", "PROJ-3"]);
    expect(plan.abandon.map((r) => r.jiraIssueKey)).toEqual(["PROJ-2"]);
  });

  it("does nothing with an empty queue", () => {
    expect(planRetries([])).toEqual({ retry: [], abandon: [] });
  });
});
