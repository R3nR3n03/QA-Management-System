import { CheckOutcome, QamsRole } from "@prisma/client";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { buildControlledValueSeedRows } from "@/lib/controlled-value-catalogues";
import { createFeature, createModule, createProduct, createRequirement } from "@/domain/catalogue";
import { approveTestCase, createTestCase, replaceSteps, submitTestCase } from "@/domain/test-cases";
import { createExecution, executionHistory } from "@/domain/executions";
import { dashboardSnapshot, listRtmLinks } from "@/domain/traceability";
import {
  createCheckBatch,
  getCheckBatch,
  listCheckBatches,
  listChecksForTestCase
} from "@/domain/checks";

/**
 * The automation check scenarios from `docs/testing-and-acceptance.md` (area "Automation
 * check"), against a real PostgreSQL database.
 *
 * These exercise the DOMAIN service, which owns the role gate, the resolution of a declared
 * business ID to a test case, and the guarantee that ingestion touches nothing else. The
 * parse itself is unit-tested without a database in `src/lib/junit-xml.test.ts`; what is
 * left to prove here is the part only PostgreSQL can answer.
 *
 * Truncates before it seeds, like every file under this config.
 */

const REQ = "automation-check-suite";

type Actor = { userId: string; role: QamsRole; requestId: string };

let lead: Actor;
let engineer: Actor;
let senior: Actor;
let tester: Actor;
let caseOneId: string;
let caseTwoId: string;
let hierarchy: { productId: string; moduleId: string; featureId: string; requirementId: string };

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

const doc = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>\n${body}`;

const suite = (tests: string) =>
  doc(`<testsuites><testsuite name="checkout.cy.ts">${tests}</testsuite></testsuites>`);

async function approvedCase(businessId: string, title: string) {
  const created = await createTestCase(
    {
      ...hierarchy,
      businessId,
      cycle: "C1",
      sprint: "S1",
      release: "R1",
      environment: "Staging",
      priority: "High",
      severity: "Major",
      title,
      objective: "Confirm the documented behaviour.",
      expectedResult: "The documented outcome is observed."
    },
    engineer
  );
  const stepped = await replaceSteps(
    created.id,
    [{ sequence: 1, action: "Do the thing.", expectedResult: "It happened." }],
    created.version,
    engineer
  );
  const submitted = await submitTestCase(created.id, stepped.version, engineer);
  await approveTestCase(created.id, submitted.version, senior);
  return created.id;
}

beforeAll(async () => {
  await truncateAll();
  await prisma.controlledValue.createMany({ data: [...buildControlledValueSeedRows("seed")] });

  lead = await makeUser("check-lead@example.test", "Check Lead", QamsRole.QA_LEAD);
  senior = await makeUser("check-senior@example.test", "Check Senior", QamsRole.SENIOR_QA_ENGINEER);
  engineer = await makeUser("check-engineer@example.test", "Check Engineer", QamsRole.QA_ENGINEER);
  tester = await makeUser("check-tester@example.test", "Check Tester", QamsRole.QA_TESTER);

  const product = await createProduct(
    { businessId: "PROD001", name: "Storefront", versionTag: "1.0", status: "Active" },
    lead
  );
  const mod = await createModule({ businessId: "MOD001", name: "Checkout", productId: product.id }, lead);
  const feature = await createFeature({ businessId: "FEAT001", name: "Guest checkout", moduleId: mod.id }, lead);
  const requirement = await createRequirement(
    { businessId: "REQ001", statement: "A guest can check out.", featureId: feature.id },
    lead
  );
  hierarchy = {
    productId: product.id,
    moduleId: mod.id,
    featureId: feature.id,
    requirementId: requirement.id
  };

  caseOneId = await approvedCase("TC-PROD001-0001", "Guest checks out with a card");
  caseTwoId = await approvedCase("TC-PROD001-0002", "Guest checks out with a wallet");
});

beforeEach(async () => {
  await prisma.check.deleteMany();
  await prisma.checkBatch.deleteMany();
});

describe("ingesting a results file", () => {
  it("writes one check per test, carrying its spec, test, outcome and instant", async () => {
    const batch = await createCheckBatch(
      lead,
      "results.xml",
      suite(
        `<testcase name="TC-PROD001-0001 pays by card" classname="Checkout" />
         <testcase name="TC-PROD001-0002 pays by wallet" classname="Checkout">
           <failure message="expected total to be 42" type="AssertionError">at line 9</failure>
         </testcase>`
      )
    );

    // The batch and its checks commit together, so a batch row exists only for an
    // ingestion that finished — which is why it carries no status column to assert.
    expect(batch.completedAt).toBeInstanceOf(Date);
    const checks = await prisma.check.findMany({ orderBy: { testName: "asc" } });
    expect(checks).toHaveLength(2);
    expect(checks[0]).toMatchObject({
      testCaseId: caseOneId,
      specName: "checkout.cy.ts",
      testName: "TC-PROD001-0001 pays by card",
      outcome: CheckOutcome.PASSED,
      failureReason: null
    });
    expect(checks[1]).toMatchObject({
      testCaseId: caseTwoId,
      outcome: CheckOutcome.FAILED,
      failureReason: "expected total to be 42"
    });
    expect(checks[0].checkedAt).toBeInstanceOf(Date);
  });

  it("reports a business ID that resolves to nothing, and still ingests every other row", async () => {
    const batch = await createCheckBatch(
      lead,
      "results.xml",
      suite(
        `<testcase name="TC-PROD001-0001 pays by card" />
         <testcase name="TC-PROD009-0099 covers a case that does not exist" />`
      )
    );

    const report = await getCheckBatch(batch.id, lead.role);
    expect(report.rows).toHaveLength(2);
    expect(report.rows.find((r) => r.businessId === "TC-PROD009-0099")).toMatchObject({
      outcome: "REFERENCE_NOT_FOUND",
      errorCode: "REFERENCE_NOT_FOUND"
    });
    expect(await prisma.check.count()).toBe(1);
  });

  it("reports a test that declares no test case at all, without refusing the file", async () => {
    const batch = await createCheckBatch(lead, "results.xml", suite(`<testcase name="an unmapped test" />`));
    const report = await getCheckBatch(batch.id, lead.role);
    expect(report.rows[0]).toMatchObject({ businessId: null, outcome: "NO_TEST_CASE_DECLARED" });
    expect(await prisma.check.count()).toBe(0);
  });

  it("refuses a malformed file before writing anything at all", async () => {
    await expect(createCheckBatch(lead, "broken.xml", "<testsuites><testsuite>")).rejects.toBeInstanceOf(
      AppError
    );
    expect(await prisma.checkBatch.count()).toBe(0);
    expect(await prisma.check.count()).toBe(0);
  });

  it("writes new checks when the same file is uploaded twice, never skipping or reconciling", async () => {
    const xml = suite(`<testcase name="TC-PROD001-0001 pays by card" />`);
    const first = await createCheckBatch(lead, "results.xml", xml);
    const second = await createCheckBatch(lead, "results.xml", xml);

    expect(second.id).not.toBe(first.id);
    expect(await prisma.check.count()).toBe(2);
    const report = await getCheckBatch(second.id, lead.role);
    expect(report.rows.map((r) => r.outcome)).toEqual(["CREATED"]);
  });

  it("audits the ingestion", async () => {
    const batch = await createCheckBatch(lead, "results.xml", suite(`<testcase name="TC-PROD001-0001 t" />`));
    const events = await prisma.auditEvent.findMany({
      where: { entityType: "CheckBatch", entityId: batch.id }
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actorId: lead.userId, action: "CHECKS_INGESTED", requestId: REQ });
  });
});

describe("who may ingest", () => {
  it.each([
    ["a QA Tester", () => tester],
    ["a QA Engineer", () => engineer],
    ["a Senior QA Engineer", () => senior]
  ])("refuses %s and writes nothing", async (_label, actor) => {
    await expect(
      createCheckBatch(actor(), "results.xml", suite(`<testcase name="TC-PROD001-0001 t" />`))
    ).rejects.toMatchObject({ status: 403, code: "UNAUTHORIZED" });
    expect(await prisma.checkBatch.count()).toBe(0);
  });

  it("refuses a non-lead the batch list, on the same rule as workbook imports", async () => {
    await expect(listCheckBatches(QamsRole.QA_ENGINEER)).rejects.toMatchObject({ status: 403 });
    await expect(listCheckBatches(QamsRole.QA_LEAD)).resolves.toBeDefined();
  });

  it("refuses a non-lead one batch's report, because it names another repository's specs", async () => {
    const batch = await createCheckBatch(lead, "results.xml", suite(`<testcase name="TC-PROD001-0001 t" />`));
    for (const actor of [tester, engineer, senior]) {
      await expect(getCheckBatch(batch.id, actor.role)).rejects.toMatchObject({ status: 403 });
    }
    await expect(getCheckBatch(batch.id, lead.role)).resolves.toBeDefined();
  });

  it("lets any role read the checks on a test case, because that follows viewing the case", async () => {
    await createCheckBatch(lead, "results.xml", suite(`<testcase name="TC-PROD001-0001 t" />`));
    const read = await listChecksForTestCase(caseOneId);
    expect(read.total).toBe(1);
    expect(read.checks).toHaveLength(1);
  });
});

describe("what ingestion must not touch", () => {
  it("leaves executions and their history alone", async () => {
    const execution = await createExecution(
      { purpose: "Sprint 1 regression", testerId: tester.userId, testCaseIds: [caseOneId] },
      lead
    );
    await createCheckBatch(
      lead,
      "results.xml",
      suite(`<testcase name="TC-PROD001-0001 t"><failure type="AssertionError">no</failure></testcase>`)
    );

    const after = await prisma.testExecution.findUniqueOrThrow({ where: { id: execution.id } });
    expect(after.state).toBe(execution.state);
    expect(after.result).toBeNull();
    expect(await executionHistory(execution.id)).toHaveLength(0);
    await prisma.testExecution.deleteMany();
  });

  it("leaves the traceability matrix and the dashboard counts alone", async () => {
    const before = await dashboardSnapshot();
    await createCheckBatch(
      lead,
      "results.xml",
      suite(`<testcase name="TC-PROD001-0001 t"><failure type="AssertionError">no</failure></testcase>`)
    );
    const after = await dashboardSnapshot();

    expect(after.testCases).toEqual(before.testCases);
    expect(after.products).toEqual(before.products);
    expect(after.executionsByState.counts).toEqual(before.executionsByState.counts);
    expect(after.executionsByState.denominatorCount).toEqual(before.executionsByState.denominatorCount);
    expect(after.testCasesByLifecycleState.counts).toEqual(before.testCasesByLifecycleState.counts);
    expect((await listRtmLinks()).rows).toHaveLength(0);
  });

  it("gives a revision none of the checks recorded against the case it revises", async () => {
    await createCheckBatch(lead, "results.xml", suite(`<testcase name="TC-PROD001-0001 t" />`));

    const revision = await createTestCase(
      {
        ...hierarchy,
        cycle: "C1",
        sprint: "S2",
        release: "R1",
        environment: "Staging",
        priority: "High",
        severity: "Major",
        title: "Guest checks out with a card, revised",
        objective: "Confirm the revised behaviour.",
        expectedResult: "The revised outcome is observed.",
        revisesTestCaseId: caseOneId
      },
      engineer
    );

    expect(revision.revisesTestCaseId).toBe(caseOneId);
    expect((await listChecksForTestCase(revision.id)).total).toBe(0);
    expect((await listChecksForTestCase(caseOneId)).total).toBe(1);
    await prisma.testCase.delete({ where: { id: revision.id } });
  });
});

describe("reading checks back", () => {
  it("caps what it returns and reports the total, so a screen can say what it left out", async () => {
    const tests = Array.from({ length: 7 }, (_, i) => `<testcase name="TC-PROD001-0001 run ${i}" />`).join("");
    await createCheckBatch(lead, "results.xml", suite(tests));

    const read = await listChecksForTestCase(caseOneId, 3);
    expect(read.checks).toHaveLength(3);
    expect(read.total).toBe(7);
  });

  it("returns the newest checks first", async () => {
    await createCheckBatch(lead, "older.xml", suite(`<testcase name="TC-PROD001-0001 older" />`));
    await createCheckBatch(lead, "newer.xml", suite(`<testcase name="TC-PROD001-0001 newer" />`));

    const read = await listChecksForTestCase(caseOneId, 2);
    expect(read.checks[0].testName).toBe("TC-PROD001-0001 newer");
  });

  it("is 404 for a batch that does not exist", async () => {
    await expect(getCheckBatch("00000000-0000-0000-0000-000000000000", lead.role)).rejects.toMatchObject({
      status: 404,
      code: "REFERENCE_NOT_FOUND"
    });
  });
});
