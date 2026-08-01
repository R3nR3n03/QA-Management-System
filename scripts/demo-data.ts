/**
 * Local development demo data — NOT a seed, and NOT for any shared environment.
 *
 * `prisma/seed.ts` bootstraps the two things the system genuinely cannot run without:
 * the documented controlled values and one QA Lead. This script is different — it
 * invents a fictional product so there is something to click through in the UI. None
 * of it is policy, none of it comes from the workbook, and it must never run against
 * anything but a local database.
 *
 * Everything except the user accounts is created **through the domain services**, on
 * purpose. `docs/architecture.md:30` forbids writes that bypass them, and driving the
 * real services means the demo data is proof the rules work rather than a fixture
 * that sidesteps them: the test case really is authored by a QA Engineer, submitted
 * by its author, and approved by a *different* Senior QA Engineer, because
 * `approveTestCase` would reject anything else.
 *
 * Users are created with Prisma directly because no domain service creates them —
 * `docs/api-and-security.md:9`: "No endpoint creates a user in v1; accounts are
 * provisioned outside the API."
 *
 *   DEMO_PASSWORD='...' npm run demo:data
 */

import "dotenv/config";
import { PrismaClient, QamsRole } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "../src/lib/password";
import { createFeature, createModule, createProduct, createRequirement } from "../src/domain/catalogue";
import {
  approveTestCase,
  createTestCase,
  replaceSteps,
  submitTestCase
} from "../src/domain/test-cases";
import { createExecution, finalizeExecution, startExecution } from "../src/domain/executions";

const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL as string) });

const password = process.env.DEMO_PASSWORD;
if (!password) {
  console.error(
    "DEMO_PASSWORD is not set. Choose one and re-run:\n" +
      "  DEMO_PASSWORD='some-local-password' npm run demo:data"
  );
  process.exit(1);
}

const rid = (label: string) => `demo-${label}`;

const PEOPLE = [
  { email: "lead@qams.local", displayName: "Priya Raman", role: QamsRole.QA_LEAD },
  { email: "senior@qams.local", displayName: "Rani Okafor", role: QamsRole.SENIOR_QA_ENGINEER },
  { email: "engineer@qams.local", displayName: "Dela Santos", role: QamsRole.QA_ENGINEER },
  { email: "tester@qams.local", displayName: "Tomas Lindqvist", role: QamsRole.QA_TESTER }
];

async function upsertPeople() {
  const made: Record<string, { id: string; role: QamsRole }> = {};
  for (const person of PEOPLE) {
    const existing = await prisma.user.findUnique({ where: { email: person.email } });
    if (existing) {
      made[person.role] = { id: existing.id, role: existing.role };
      continue;
    }
    const user = await prisma.user.create({
      data: {
        email: person.email,
        displayName: person.displayName,
        passwordHash: hashPassword(password as string),
        role: person.role,
        createdBy: "demo-data",
        updatedBy: "demo-data"
      }
    });
    made[person.role] = { id: user.id, role: user.role };
  }
  return made;
}

async function main() {
  if (await prisma.product.findUnique({ where: { businessId: "PROD001" } })) {
    console.log("PROD001 already exists — demo data looks present. Nothing to do.");
    return;
  }

  const people = await upsertPeople();
  const lead = { userId: people[QamsRole.QA_LEAD].id, role: QamsRole.QA_LEAD, requestId: rid("lead") };
  const senior = {
    userId: people[QamsRole.SENIOR_QA_ENGINEER].id,
    role: QamsRole.SENIOR_QA_ENGINEER,
    requestId: rid("senior")
  };
  const engineer = {
    userId: people[QamsRole.QA_ENGINEER].id,
    role: QamsRole.QA_ENGINEER,
    requestId: rid("engineer")
  };
  const tester = {
    userId: people[QamsRole.QA_TESTER].id,
    role: QamsRole.QA_TESTER,
    requestId: rid("tester")
  };
  console.log(`People: ${PEOPLE.length} accounts ready.`);

  // --- Catalogue. QA Lead only, per src/domain/catalogue.ts. ---
  const product = await createProduct(
    { businessId: "PROD001", name: "Storefront", versionTag: "2.4", status: "Active" },
    lead
  );
  const testModule = await createModule(
    { businessId: "MOD001", name: "Checkout", productId: product.id },
    lead
  );
  const feature = await createFeature(
    { businessId: "FEAT001", name: "Guest checkout", moduleId: testModule.id },
    lead
  );
  const requirement = await createRequirement(
    {
      businessId: "REQ001",
      statement: "A guest can complete a purchase without creating an account.",
      featureId: feature.id
    },
    lead
  );
  console.log("Catalogue: PROD001 > MOD001 > FEAT001 > REQ001.");

  const hierarchy = {
    productId: product.id,
    moduleId: testModule.id,
    featureId: feature.id,
    requirementId: requirement.id,
    cycle: "Regression",
    sprint: "Sprint 14",
    release: "2.4",
    environment: "QA"
  };

  // --- Test design. Authored by the QA Engineer, approved by the Senior. ---
  async function authorCase(businessId: string, title: string, objective: string) {
    const created = await createTestCase(
      {
        ...hierarchy,
        businessId,
        priority: "High",
        severity: "Major",
        title,
        objective,
        expectedResult: "The documented outcome is observed and nothing else changes."
      },
      engineer
    );
    const stepped = await replaceSteps(
      created.id,
      [
        { sequence: 1, action: "Add an item to the basket as a guest.", expectedResult: "Basket shows 1 item." },
        { sequence: 2, action: "Proceed to checkout without signing in.", expectedResult: "Guest checkout form opens." },
        { sequence: 3, action: "Pay with the card under test.", expectedResult: "The documented outcome is observed." }
      ],
      created.version,
      engineer
    );
    return { id: created.id, version: stepped.version };
  }

  // Approved — the only state an execution may reference.
  const approved = await authorCase(
    "TC-STOREFRONT-0001",
    "Guest checkout rejects an expired card",
    "Confirm an expired card is declined with a clear message and nothing is charged."
  );
  const submitted = await submitTestCase(approved.id, approved.version, engineer);
  // Deliberately the Senior, not the author: approveTestCase rejects self-approval
  // (roles-workflows.md:19). If this line ever throws, that rule is working.
  await approveTestCase(approved.id, submitted.version, senior);

  // In Review — so the review queue has something in it.
  const inReview = await authorCase(
    "TC-STOREFRONT-0002",
    "Guest checkout accepts a valid card",
    "Confirm a valid card completes the order and the confirmation shows the masked number."
  );
  await submitTestCase(inReview.id, inReview.version, engineer);

  // Draft — so "My drafts" is not empty.
  await authorCase(
    "TC-STOREFRONT-0003",
    "Guest checkout handles a network drop mid-payment",
    "Confirm an interrupted payment leaves no partial order."
  );
  console.log("Test design: 1 Approved, 1 In Review, 1 Draft.");

  // --- Executions, all assigned to the QA Tester. ---
  const planned = await createExecution(
    { businessId: "EXE-0001", testCaseIds: [approved.id], testerId: tester.userId },
    lead
  );

  const running = await createExecution(
    { businessId: "EXE-0002", testCaseIds: [approved.id], testerId: tester.userId },
    lead
  );
  await startExecution(running.id, running.version, tester);

  const finished = await createExecution(
    { businessId: "EXE-0003", testCaseIds: [approved.id], testerId: tester.userId },
    lead
  );
  const started = await startExecution(finished.id, finished.version, tester);
  await finalizeExecution(
    finished.id,
    {
      version: started.version,
      results: [
        {
          testCaseId: approved.id,
          result: "PASS",
          actualResult: "The expired card was declined and the basket was left untouched."
        }
      ]
    },
    tester
  );

  console.log(`Executions: ${planned.businessId} Planned, EXE-0002 In Progress, EXE-0003 Finalized (Pass).`);
  console.log("\nSign in at http://localhost:3000/login");
  for (const person of PEOPLE) console.log(`  ${person.email}  (${person.role})`);
  console.log("The work queue belongs to tester@qams.local.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
