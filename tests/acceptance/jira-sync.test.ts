import { QamsRole, ExecutionOutcome, JiraSyncOutcome } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { buildControlledValueSeedRows } from "@/lib/controlled-value-catalogues";
import { createProduct, createModule, createFeature, createRequirement } from "@/domain/catalogue";
import { createTestCase, replaceSteps, submitTestCase, approveTestCase } from "@/domain/test-cases";
import { createExecution, startExecution, finalizeExecution } from "@/domain/executions";
import {
  setJiraTransport,
  type JiraTransport,
  type JiraTransitionRequest,
  type JiraCommentRequest
} from "@/domain/jira-sync";

/**
 * The Jira transition trigger, end to end through `finalizeExecution`
 * (`docs/architecture.md#Jira execution sync`).
 *
 * Nothing covered this path before: `jira-sync.test.ts` in `src/domain/` tests
 * `shouldTransitionIssue` in isolation, and no test had ever driven a finalize with a
 * transport installed. The defect this file reproduces lives in the gap between the two.
 */

type Actor = { userId: string; role: QamsRole; requestId: string };

const REQ = "jira-sync-suite";
const ISSUE_KEY = "QAS-4242";

let lead: Actor;
let engineer: Actor;
let senior: Actor;
let tester: Actor;

let featureIds: { productId: string; moduleId: string; featureId: string; requirementId: string };

/** Every transition and comment the domain asked for, in order. */
const transitions: JiraTransitionRequest[] = [];
const comments: JiraCommentRequest[] = [];

const recordingTransport: JiraTransport = {
  async transitionToDone(request) {
    transitions.push(request);
    return { outcome: JiraSyncOutcome.SUCCEEDED, actorId: request.actorId };
  },
  async postComment(request) {
    comments.push(request);
    return { outcome: "SUCCEEDED", commentId: `fake-${comments.length}`, actorId: request.actorId };
  },
  // This suite covers the execution sync and never raises a defect issue. Implemented because
  // the port requires it, and made to FAIL rather than succeed: if a change ever routes a
  // defect create through here, that should show up as a failing expectation rather than as a
  // silently invented issue key. The defect sync has its own suite.
  async createIssue(request) {
    return {
      outcome: JiraSyncOutcome.FAILED,
      failureReason: "The execution sync suite does not raise defect issues.",
      actorId: request.actorId
    };
  }
};

async function truncateAll() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  const joined = tables.map((t) => `"${t.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${joined} RESTART IDENTITY CASCADE`);
}

async function makeUser(email: string, displayName: string, role: QamsRole): Promise<Actor> {
  const user = await prisma.user.create({
    data: { email, displayName, role, passwordHash: "not-a-real-hash", createdBy: "test", updatedBy: "test" }
  });
  return { userId: user.id, role, requestId: REQ };
}

async function approvedCase(businessId: string, title: string): Promise<string> {
  const draft = await createTestCase(
    {
      businessId,
      ...featureIds,
      cycle: "C1",
      sprint: "S1",
      release: "R1",
      environment: "QA",
      priority: "High",
      severity: "Major",
      title,
      objective: `Verify ${title.toLowerCase()}`,
      expectedResult: "It works"
    },
    engineer
  );
  const withSteps = await replaceSteps(
    draft.id,
    [{ sequence: 1, action: "Do the thing", expectedResult: "It worked" }],
    draft.version,
    engineer
  );
  const submitted = await submitTestCase(draft.id, withSteps.version, engineer);
  await approveTestCase(draft.id, submitted.version, senior);
  return draft.id;
}

/** Plan, start and finalize one all-Pass run against `ISSUE_KEY`. */
async function runOnePassingExecution(businessId: string, testCaseId: string) {
  const execution = await createExecution(
    { businessId, testCaseIds: [testCaseId], testerId: tester.userId, purpose: `Run ${businessId}`, jiraIssueKey: ISSUE_KEY },
    lead
  );
  const started = await startExecution(execution.id, execution.version, tester);
  return finalizeExecution(
    started.id,
    {
      version: started.version,
      results: [{ testCaseId, result: ExecutionOutcome.PASS, actualResult: "Fine" }]
    },
    tester
  );
}

beforeAll(async () => {
  await truncateAll();
  await prisma.controlledValue.createMany({ data: [...buildControlledValueSeedRows("test")] });
  lead = await makeUser("lead@jira.local", "Jira Lead", QamsRole.QA_LEAD);
  senior = await makeUser("senior@jira.local", "Jira Senior", QamsRole.SENIOR_QA_ENGINEER);
  engineer = await makeUser("engineer@jira.local", "Jira Engineer", QamsRole.QA_ENGINEER);
  tester = await makeUser("tester@jira.local", "Jira Tester", QamsRole.QA_ENGINEER);

  const product = await createProduct({ businessId: "PROD900", name: "Jira Fixture", versionTag: "1.0", status: "Active" }, lead);
  const moduleRow = await createModule({ businessId: "MOD900", name: "Sync", productId: product.id }, lead);
  const feature = await createFeature({ businessId: "FEAT900", name: "Transition", moduleId: moduleRow.id }, lead);
  const requirement = await createRequirement({ businessId: "REQ900", statement: "A finished run closes its issue", featureId: feature.id }, lead);
  featureIds = { productId: product.id, moduleId: moduleRow.id, featureId: feature.id, requirementId: requirement.id };

  setJiraTransport(recordingTransport);
});

afterAll(() => {
  setJiraTransport(null);
});

describe("Jira transition on finalize", () => {
  it("the first all-Pass run carrying an issue key transitions that issue", async () => {
    const caseOne = await approvedCase("TC-PROD900-0001", "First check");
    const finalized = await runOnePassingExecution("EXE-9001", caseOne);

    expect(finalized.result).toBe(ExecutionOutcome.PASS);
    expect(transitions.map((t) => t.issueKey)).toEqual([ISSUE_KEY]);

    const attempts = await prisma.jiraSyncAttempt.findMany({ where: { jiraIssueKey: ISSUE_KEY } });
    expect(attempts).toHaveLength(1);
    expect(attempts[0].outcome).toBe(JiraSyncOutcome.SUCCEEDED);
  });

  it("a LATER, separate all-Pass run on the same issue key transitions it again", async () => {
    // The reported defect. The issue has since been moved off Done by a person -- Building,
    // then Testing -- and a new run has now verified it a second time. QAMS finalizes that
    // run all-Pass and never attempts a transition, because one SUCCEEDED row for this key
    // already exists from the earlier run (`settleJiraSync`, src/domain/executions.ts:866).
    const caseTwo = await approvedCase("TC-PROD900-0002", "Second check");
    const before = transitions.length;

    const finalized = await runOnePassingExecution("EXE-9002", caseTwo);
    expect(finalized.result).toBe(ExecutionOutcome.PASS);

    expect(transitions.length).toBe(before + 1);
    expect(transitions.at(-1)?.issueKey).toBe(ISSUE_KEY);
  });

  it("a run held open by a sibling records WHY the issue did not move, naming the sibling", async () => {
    // The other half of "I finalized and nothing happened", and the far more common one: the
    // transition waits on every run sharing the key, and a tester cannot see those from their
    // own run. Before ADR-0005 this path returned silently and left no trace anywhere.
    const heldKey = "QAS-4243";
    const caseThree = await approvedCase("TC-PROD900-0003", "Third check");
    const caseFour = await approvedCase("TC-PROD900-0004", "Fourth check");

    const stillOpen = await createExecution(
      { businessId: "EXE-9003", testCaseIds: [caseThree], testerId: tester.userId, purpose: "Left planned", jiraIssueKey: heldKey },
      lead
    );
    const finishing = await createExecution(
      { businessId: "EXE-9004", testCaseIds: [caseFour], testerId: tester.userId, purpose: "Finishing first", jiraIssueKey: heldKey },
      lead
    );

    const before = transitions.length;
    const started = await startExecution(finishing.id, finishing.version, tester);
    await finalizeExecution(
      started.id,
      { version: started.version, results: [{ testCaseId: caseFour, result: ExecutionOutcome.PASS, actualResult: "Fine" }] },
      tester
    );

    // No call to Jira: EXE-9003 is still Planned, so the issue is not verified.
    expect(transitions.length).toBe(before);

    const skipped = await prisma.jiraSyncAttempt.findFirst({
      where: { jiraIssueKey: heldKey },
      orderBy: { attemptedAt: "desc" }
    });
    expect(skipped?.outcome).toBe(JiraSyncOutcome.SKIPPED);
    expect(skipped?.executionId).toBe(finishing.id);
    expect(skipped?.failureReason).toContain(stillOpen.businessId);
    expect(skipped?.failureReason).toContain("not finalized yet");

    // Audited like any other attempt: `docs/api-and-security.md` requires every decision
    // about a Jira issue to leave a trace in the append-only log.
    const audit = await prisma.auditEvent.findFirst({
      where: { action: "JIRA_SYNC_SKIPPED", entityId: finishing.id }
    });
    expect(audit).not.toBeNull();
  });
});
