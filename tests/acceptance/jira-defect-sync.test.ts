import {
  DefectLifecycleState,
  JiraDefectAction,
  JiraSyncOutcome,
  QamsRole
} from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { buildControlledValueSeedRows } from "@/lib/controlled-value-catalogues";
import { createProduct, createModule, createFeature, createRequirement } from "@/domain/catalogue";
import { createTestCase, replaceSteps, submitTestCase, approveTestCase } from "@/domain/test-cases";
import { createDefect, listDefects, transitionDefect } from "@/domain/defects";
import {
  setJiraTransport,
  type JiraCommentRequest,
  type JiraCreateIssueRequest,
  type JiraTransport,
  type JiraTransitionRequest
} from "@/domain/jira-sync";

/**
 * The defect sync, end to end through `createDefect` and `transitionDefect`
 * (`docs/architecture.md#Jira defect sync`, ADR-0006).
 *
 * The counterpart of `jira-sync.test.ts`, and it exists for the same reason: the pure rules in
 * `src/domain/jira-defect.test.ts` prove what a comment SAYS and when an issue SHOULD move,
 * and neither of them can catch a settle function that is never called, records the wrong
 * outcome, or lets a Jira failure escape as a failed defect create. That gap is what this
 * file covers.
 */

type Actor = { userId: string; role: QamsRole; requestId: string };

const REQ = "jira-defect-suite";
const PROJECT_KEY = "BUG";

let lead: Actor;
let engineer: Actor;
let senior: Actor;
let testCaseId: string;

/** Every call the domain made, in order. */
const creates: JiraCreateIssueRequest[] = [];
const comments: JiraCommentRequest[] = [];
const transitions: JiraTransitionRequest[] = [];

/** Flipped per test to make one half of the transport fail. */
let createShouldFail = false;
let nextIssueKey = 1;

const recordingTransport: JiraTransport = {
  async createIssue(request) {
    creates.push(request);
    if (createShouldFail) {
      return {
        outcome: JiraSyncOutcome.FAILED,
        failureReason: "Jira refused to create the issue (HTTP 400): issuetype: not valid.",
        actorId: request.actorId
      };
    }
    return {
      outcome: JiraSyncOutcome.SUCCEEDED,
      issueKey: `${PROJECT_KEY}-${nextIssueKey++}`,
      adopted: false,
      actorId: request.actorId
    };
  },
  async postComment(request) {
    comments.push(request);
    return { outcome: "SUCCEEDED", commentId: `c-${comments.length}`, actorId: request.actorId };
  },
  async transitionToDone(request) {
    transitions.push(request);
    return { outcome: JiraSyncOutcome.SUCCEEDED, actorId: request.actorId };
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

/** The attempts recorded for one defect, newest first. */
async function attempts(defectId: string, action: JiraDefectAction) {
  return prisma.jiraDefectAttempt.findMany({
    where: { defectId, action },
    orderBy: { attemptedAt: "desc" }
  });
}

beforeAll(async () => {
  // `jiraConfig()` reads `process.env` on every call, so setting these here is enough to turn
  // the integration on for this suite. The transport is a stub either way — nothing in this
  // file reaches the network.
  process.env.JIRA_BASE_URL = "https://acme.atlassian.net";
  process.env.JIRA_OAUTH_CLIENT_ID = "client-abc";
  process.env.JIRA_OAUTH_CLIENT_SECRET = "secret-xyz";
  process.env.JIRA_REDIRECT_URI = "https://qams.example.com/api/v1/jira/callback";
  process.env.JIRA_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  // No JIRA_DEFECT_PROJECT_KEY: the project a defect's bug goes to is catalogue data now,
  // set on the product below.

  await truncateAll();
  await prisma.controlledValue.createMany({ data: [...buildControlledValueSeedRows("test")] });
  lead = await makeUser("lead@defect.local", "Defect Lead", QamsRole.QA_LEAD);
  senior = await makeUser("senior@defect.local", "Defect Senior", QamsRole.SENIOR_QA_ENGINEER);
  engineer = await makeUser("engineer@defect.local", "Defect Engineer", QamsRole.QA_ENGINEER);

  const product = await createProduct(
    {
      businessId: "PROD800",
      name: "Defect Fixture",
      versionTag: "1.0",
      status: "Active",
      // This is what switches the defect sync on for everything raised against this product.
      jiraProjectKey: PROJECT_KEY
    },
    lead
  );
  const moduleRow = await createModule({ businessId: "MOD800", name: "Sync", productId: product.id }, lead);
  const feature = await createFeature({ businessId: "FEAT800", name: "Raise", moduleId: moduleRow.id }, lead);
  const requirement = await createRequirement(
    { businessId: "REQ800", statement: "A raised defect reaches Jira", featureId: feature.id },
    lead
  );

  const draft = await createTestCase(
    {
      businessId: "TC-DEFECT-0001",
      productId: product.id,
      moduleId: moduleRow.id,
      featureId: feature.id,
      requirementId: requirement.id,
      cycle: "C1",
      sprint: "S1",
      release: "R1",
      environment: "QA",
      priority: "High",
      severity: "Major",
      title: "Cart totals include tax",
      objective: "Verify tax is applied",
      expectedResult: "Total includes VAT"
    },
    engineer
  );
  const withSteps = await replaceSteps(
    draft.id,
    [{ sequence: 1, action: "Open the cart", expectedResult: "It opens" }],
    draft.version,
    engineer
  );
  const submitted = await submitTestCase(draft.id, withSteps.version, engineer);
  await approveTestCase(draft.id, submitted.version, senior);
  testCaseId = draft.id;

  setJiraTransport(recordingTransport);
});

afterAll(() => {
  setJiraTransport(null);
});

beforeEach(() => {
  creates.length = 0;
  comments.length = 0;
  transitions.length = 0;
  createShouldFail = false;
});

async function raiseDefect(summary: string) {
  return createDefect(
    { testCaseId, summary, priority: "High", severity: "Major" },
    engineer
  );
}

describe("raising a defect raises a Jira bug", () => {
  it("creates the issue and stores the key it comes back with", async () => {
    const defect = await raiseDefect("Checkout total excludes VAT");

    expect(creates).toHaveLength(1);
    expect(creates[0].projectKey).toBe(PROJECT_KEY);
    expect(creates[0].issueType).toBe("Bug");
    // The label is what makes a retry able to recognise its own work rather than duplicate it.
    expect(creates[0].labels).toEqual([`qams-${defect.businessId}`]);

    const stored = await prisma.defect.findUniqueOrThrow({ where: { id: defect.id } });
    expect(stored.jiraIssueKey).toMatch(/^BUG-\d+$/);

    // The returned row carries it too. The row committed by the transaction predates the
    // issue, so returning that one would report `jiraIssueKey: null` for a defect that has
    // one — a plain falsehood to an API caller, who has no attempt history to check against.
    expect(defect.jiraIssueKey).toBe(stored.jiraIssueKey);
  });

  it("records the attempt and audits it", async () => {
    const defect = await raiseDefect("Totals are wrong");

    const [attempt] = await attempts(defect.id, JiraDefectAction.CREATE);
    expect(attempt.outcome).toBe(JiraSyncOutcome.SUCCEEDED);
    expect(attempt.jiraIssueKey).toMatch(/^BUG-\d+$/);

    const audit = await prisma.auditEvent.findFirst({
      where: { entityId: defect.id, action: "JIRA_DEFECT_ISSUE_CREATED" }
    });
    expect(audit).not.toBeNull();
  });

  // The whole point of settling after the commit: an unreachable Jira must never cost someone
  // the defect they raised.
  it("still creates the defect when Jira refuses the issue", async () => {
    createShouldFail = true;
    const defect = await raiseDefect("Jira is having a bad day");

    const stored = await prisma.defect.findUniqueOrThrow({ where: { id: defect.id } });
    expect(stored.id).toBe(defect.id);
    expect(stored.jiraIssueKey).toBeNull();

    const [attempt] = await attempts(defect.id, JiraDefectAction.CREATE);
    expect(attempt.outcome).toBe(JiraSyncOutcome.FAILED);
    // The reason Jira gave is kept, because it is the difference between a QA Lead fixing one
    // variable and guessing.
    expect(attempt.failureReason).toContain("issuetype");
  });
});

describe("a lifecycle transition is narrated on the issue", () => {
  it("comments with the transition's rationale", async () => {
    const defect = await raiseDefect("Narrate me");
    const triaged = await transitionDefect(
      defect.id,
      { version: defect.version, targetStatus: DefectLifecycleState.TRIAGED },
      lead
    );
    await transitionDefect(
      defect.id,
      {
        version: triaged.version,
        targetStatus: DefectLifecycleState.IN_PROGRESS,
        investigationOwnerId: senior.userId
      },
      lead
    );

    expect(comments).toHaveLength(2);
    expect(comments[1].body).toContain("Triaged → In progress");
    // The owner is resolved to a name: a UUID in someone else's ticket names nobody.
    expect(comments[1].body).toContain("Defect Senior");
  });

  // A comment reports; only a transition claims the work is finished.
  it("does not transition the issue before the defect closes", async () => {
    const defect = await raiseDefect("Not done yet");
    await transitionDefect(
      defect.id,
      { version: defect.version, targetStatus: DefectLifecycleState.TRIAGED },
      lead
    );

    expect(comments).toHaveLength(1);
    expect(transitions).toHaveLength(0);
  });
});

describe("closing a defect closes its issue", () => {
  it("transitions the issue to done, and records it", async () => {
    const defect = await raiseDefect("Close me");

    let current = await transitionDefect(
      defect.id,
      { version: defect.version, targetStatus: DefectLifecycleState.TRIAGED },
      lead
    );
    current = await transitionDefect(
      defect.id,
      {
        version: current.version,
        targetStatus: DefectLifecycleState.IN_PROGRESS,
        investigationOwnerId: senior.userId
      },
      lead
    );
    current = await transitionDefect(
      defect.id,
      {
        version: current.version,
        targetStatus: DefectLifecycleState.RESOLVED,
        resolutionSummary: "Tax applied before the total is rendered."
      },
      lead
    );
    expect(transitions).toHaveLength(0);

    await transitionDefect(
      defect.id,
      {
        version: current.version,
        targetStatus: DefectLifecycleState.CLOSED,
        retestEvidenceRef: "EXE-0042",
        closureRationale: "Verified on staging."
      },
      lead
    );

    expect(transitions).toHaveLength(1);
    expect(transitions[0].issueKey).toMatch(/^BUG-\d+$/);

    const [attempt] = await attempts(defect.id, JiraDefectAction.TRANSITION);
    expect(attempt.outcome).toBe(JiraSyncOutcome.SUCCEEDED);

    // The closure comment carries the evidence that justified it.
    const closing = comments[comments.length - 1];
    expect(closing.body).toContain("Resolved → Closed");
    expect(closing.body).toContain("Retest evidence");
  });
});

describe("a product that raises no bugs", () => {
  /**
   * The switch that replaced `JIRA_DEFECT_PROJECT_KEY`. Jira is fully configured for this
   * suite, so this proves the product's own key is what decides — not the connection.
   */
  it("raises nothing, and records no attempt", async () => {
    const product = await createProduct(
      // No jiraProjectKey: the default for every product.
      { businessId: "PROD801", name: "Unrouted", versionTag: "1.0", status: "Active" },
      lead
    );
    const moduleRow = await createModule(
      { businessId: "MOD801", name: "Unrouted module", productId: product.id },
      lead
    );
    const feature = await createFeature(
      { businessId: "FEAT801", name: "Unrouted feature", moduleId: moduleRow.id },
      lead
    );
    const requirement = await createRequirement(
      { businessId: "REQ801", statement: "Nothing reaches Jira", featureId: feature.id },
      lead
    );
    const draft = await createTestCase(
      {
        businessId: "TC-UNROUTED-0001",
        productId: product.id,
        moduleId: moduleRow.id,
        featureId: feature.id,
        requirementId: requirement.id,
        cycle: "C1",
        sprint: "S1",
        release: "R1",
        environment: "QA",
        priority: "High",
        severity: "Major",
        title: "Unrouted case",
        objective: "Verify nothing is raised",
        expectedResult: "Nothing"
      },
      engineer
    );
    const withSteps = await replaceSteps(
      draft.id,
      [{ sequence: 1, action: "Do nothing", expectedResult: "Nothing" }],
      draft.version,
      engineer
    );
    const submitted = await submitTestCase(draft.id, withSteps.version, engineer);
    await approveTestCase(draft.id, submitted.version, senior);

    const defect = await createDefect(
      { testCaseId: draft.id, summary: "Goes nowhere", priority: "High", severity: "Major" },
      engineer
    );

    expect(creates).toHaveLength(0);
    expect(defect.jiraIssueKey).toBeNull();
    // Not even a failed row: nobody asked for this, so there is no decision to record.
    expect(await attempts(defect.id, JiraDefectAction.CREATE)).toHaveLength(0);
  });
});

describe("finding a defect from its Jira bug", () => {
  // The reverse lookup: someone arriving with a Jira ticket in hand searches for the
  // identifier printed on the bug they are holding.
  it("returns the defect when the list is searched by its issue key", async () => {
    const defect = await raiseDefect("Findable by its bug");
    const stored = await prisma.defect.findUniqueOrThrow({ where: { id: defect.id } });
    const key = stored.jiraIssueKey as string;

    const { rows } = await listDefects({ query: key });
    expect(rows.map((row) => row.id)).toContain(defect.id);

    // Case-insensitively, like every other needle this list matches.
    const lower = await listDefects({ query: key.toLowerCase() });
    expect(lower.rows.map((row) => row.id)).toContain(defect.id);
  });
});

describe("a defect with no issue", () => {
  // The failed CREATE is already the whole story; a COMMENT row per transition saying "no
  // issue" would duplicate it once per step.
  it("is not commented on, and records no comment attempt", async () => {
    createShouldFail = true;
    const defect = await raiseDefect("No issue for me");
    createShouldFail = false;

    await transitionDefect(
      defect.id,
      { version: defect.version, targetStatus: DefectLifecycleState.TRIAGED },
      lead
    );

    expect(comments).toHaveLength(0);
    expect(await attempts(defect.id, JiraDefectAction.COMMENT)).toHaveLength(0);
  });
});
