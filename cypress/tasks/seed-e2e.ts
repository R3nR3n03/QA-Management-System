/**
 * The fixture the browser suite runs against: truncates, seeds, and writes down what it created.
 *
 * Run by `npm run e2e:seed` BEFORE Cypress starts, never as a Cypress task: a Node process
 * spawned from Cypress's Electron parent dies on its first module load with Windows status
 * 0xC0000409, which `cypress.config.ts` documents. The ids land in `cypress/.seed.json`, which the
 * `db:seeded` task reads.
 *
 * Everything except the user accounts is created **through the domain services**, on the rule
 * `scripts/demo-data.ts` records: `docs/architecture.md:30` forbids writes that bypass them,
 * and driving the real services means the fixture is proof the rules hold rather than an
 * arrangement that sidesteps them. The IN_REVIEW case below really is authored by the QA
 * Engineer, so `approveTestCase` really will refuse that engineer — which is the whole point of
 * `test-case-approval.cy.ts`.
 *
 * Users are created with Prisma directly because no domain service creates one
 * (`docs/api-and-security.md:9`: "No endpoint creates a user in v1").
 */

// MUST be first: points DATABASE_URL at qams_test before `src/lib/db.ts` reads it. See the file.
import "./use-test-db";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient, QamsRole } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "../../src/lib/password";
import { buildControlledValueSeedRows } from "../../src/lib/controlled-value-catalogues";
import {
  createFeature,
  createModule,
  createProduct,
  createRequirement
} from "../../src/domain/catalogue";
import { createTestCase, replaceSteps, submitTestCase, approveTestCase } from "../../src/domain/test-cases";
import { ACCOUNTS, E2E_PASSWORD, SEED_FILE, type SeededData } from "../support/accounts";

/**
 * A fixed literal rather than a required environment variable, unlike `prisma/seed.ts` and
 * `scripts/demo-data.ts` — and what makes that safe is the guard below, not the password.
 *
 * Those two scripts gate on a variable because they can be pointed at any database, so the
 * variable is the only thing between a convenience default and a real deployment. This script
 * cannot be pointed anywhere: it refuses to start unless the database it is about to TRUNCATE is
 * named for testing. A guard on the actual hazard beats a ritual that only inconveniences whoever
 * runs the suite — and it keeps the credential identical on both sides without an env round trip
 * the browser would have to read back (see `../support/accounts.ts`).
 */
const rid = (label: string) => `e2e-${label}`;

/** What every domain service takes as its caller. Mirrors the shape each of them declares. */
type Actor = { userId: string; role: QamsRole; requestId: string };

/**
 * The one thing standing between this script and somebody's real data.
 *
 * It TRUNCATES every table, so being wrong about which database is connected is the only
 * mistake here that cannot be undone. The name must end `_test`, which `testDatabaseUrl()`
 * guarantees (`qams_test`) and a hand-set `TEST_DATABASE_URL` has to earn. Checked against the
 * URL this process was actually handed, not against what the caller intended to hand it.
 */
function assertTestDatabase(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set; copy .env.example to .env first.");
  const name = new URL(url).pathname.replace(/^\//, "").split("?")[0];
  if (!/_test$/.test(name)) {
    throw new Error(
      `Refusing to seed: the database is "${name}", which is not a test database.\n` +
        "This script truncates every table. It runs only against a name ending in _test " +
        "(the browser suite uses qams_test, derived from DATABASE_URL)."
    );
  }
  return name;
}

const dbName = assertTestDatabase();
const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL as string) });

/**
 * Derived from `ACCOUNTS` rather than restated, so the rows this creates and the addresses
 * `cy.loginAs` signs in with cannot drift apart. The role is the key there and the column here.
 */
const PEOPLE = (Object.keys(ACCOUNTS) as Array<keyof typeof ACCOUNTS>).map((role) => ({
  email: ACCOUNTS[role].email,
  displayName: ACCOUNTS[role].displayName,
  role: QamsRole[role]
}));

/** Every table but Prisma's own migration ledger, the same list the acceptance suite clears. */
async function truncateAll() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  const joined = tables.map((t) => `"${t.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${joined} RESTART IDENTITY CASCADE`);
}

async function seedControlledValues() {
  // Without these every createTestCase / createDefect rejects with CONTROLLED_VALUE_INVALID,
  // so a truncated database is unusable until they are back.
  for (const row of buildControlledValueSeedRows("e2e")) {
    await prisma.controlledValue.create({
      data: {
        catalogue: row.catalogue,
        value: row.value,
        createdBy: row.createdBy,
        updatedBy: row.updatedBy
      }
    });
  }
}

async function main(): Promise<SeededData> {
  await truncateAll();
  await seedControlledValues();

  const people: Record<string, string> = {};
  for (const person of PEOPLE) {
    const user = await prisma.user.create({
      data: {
        email: person.email,
        displayName: person.displayName,
        passwordHash: hashPassword(E2E_PASSWORD),
        role: person.role,
        createdBy: "e2e",
        updatedBy: "e2e"
      }
    });
    people[person.role] = user.id;
  }

  const lead = { userId: people[QamsRole.QA_LEAD], role: QamsRole.QA_LEAD, requestId: rid("lead") };
  const senior = {
    userId: people[QamsRole.SENIOR_QA_ENGINEER],
    role: QamsRole.SENIOR_QA_ENGINEER,
    requestId: rid("senior")
  };
  const engineer = {
    userId: people[QamsRole.QA_ENGINEER],
    role: QamsRole.QA_ENGINEER,
    requestId: rid("engineer")
  };

  // --- Catalogue. QA Lead only, per src/domain/catalogue.ts. ---
  const product = await createProduct(
    { businessId: "PROD001", name: "Storefront", versionTag: "2.4", status: "Active" },
    lead
  );
  const qamsModule = await createModule(
    { businessId: "MOD001", name: "Checkout", productId: product.id },
    lead
  );
  const feature = await createFeature(
    { businessId: "FEAT001", name: "Guest checkout", moduleId: qamsModule.id },
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

  const hierarchy = {
    productId: product.id,
    moduleId: qamsModule.id,
    featureId: feature.id,
    requirementId: requirement.id,
    cycle: "Regression",
    sprint: "Sprint 14",
    release: "2.4",
    environment: "QA"
  };

  async function authorCase(businessId: string, title: string, actor: Actor = engineer) {
    const created = await createTestCase(
      {
        ...hierarchy,
        businessId,
        priority: "High",
        severity: "Major",
        title,
        objective: "Confirm the documented behaviour holds and nothing else changes.",
        expectedResult: "The documented outcome is observed and nothing else changes."
      },
      actor
    );
    const stepped = await replaceSteps(
      created.id,
      [
        { sequence: 1, action: "Add an item to the basket as a guest.", expectedResult: "Basket shows 1 item." },
        { sequence: 2, action: "Proceed to checkout without signing in.", expectedResult: "Guest checkout form opens." }
      ],
      created.version,
      actor
    );
    return { id: created.id, businessId, version: stepped.version };
  }

  // Approved: the state a check can be recorded against and an execution may reference.
  // Approved by the SENIOR and not its author, because approveTestCase rejects self-approval
  // (`docs/roles-workflows.md`). If that line ever throws, the rule is working.
  const approved = await authorCase("TC-STOREFRONT-0001", "Guest checkout rejects an expired card");
  const submittedApproved = await submitTestCase(approved.id, approved.version, engineer);
  await approveTestCase(approved.id, submittedApproved.version, senior);

  // Left IN_REVIEW, authored by the engineer, so `test-case-approval.cy.ts` has a case where
  // the author must be refused and a different reviewer must be offered the control.
  const inReview = await authorCase("TC-STOREFRONT-0002", "Guest checkout accepts a valid card");
  await submitTestCase(inReview.id, inReview.version, engineer);

  /*
   * Authored by the SENIOR and left IN_REVIEW, which is the only way to reach the screen's
   * author-refusal copy at all.
   *
   * "An author cannot approve their own work" is a rule about REVIEWERS. The Review section is
   * gated on the viewer being one (`mayReview` in `test-cases/[id]/page.tsx`), so a QA Engineer
   * author never sees it — they are refused earlier and more completely, by the section being
   * absent. Only a Senior or a Lead can be both the author of a case and someone the screen
   * would otherwise offer the control to, so only they can meet that sentence.
   */
  const seniorAuthored = await authorCase(
    "TC-STOREFRONT-0003",
    "Guest checkout keeps the basket when a card is declined",
    senior
  );
  await submitTestCase(seniorAuthored.id, seniorAuthored.version, senior);

  // The specs read this off stdout. Business IDs matter more than row ids here: a spec names
  // the case in a results file by its business ID, which is the only link ingestion has.
  return {
    database: dbName,
    users: PEOPLE.map((p) => ({ email: p.email, role: p.role, displayName: p.displayName })),
    approvedCase: { id: approved.id, businessId: approved.businessId },
    inReviewCase: { id: inReview.id, businessId: inReview.businessId },
    seniorAuthoredCase: { id: seniorAuthored.id, businessId: seniorAuthored.businessId }
  };
}

main()
  .then(async (result) => {
    await prisma.$disconnect();
    /*
     * Written to disk, and read back by the `db:seeded` Cypress task.
     *
     * A file and not a return value because this script cannot run as a child of Cypress at all:
     * a Node process spawned from Cypress's Electron parent dies immediately with Windows status
     * 0xC0000409 (STACK_BUFFER_OVERRUN) the moment it loads a module — verified against absolute
     * paths, an explicit cwd, and a cleared NODE_OPTIONS, so it is not a resolution problem.
     * `npm run test:e2e` therefore runs this first, in npm's own shell where it works, and the
     * task does nothing but `readFileSync`.
     */
    const out = path.join(__dirname, "..", SEED_FILE);
    writeFileSync(out, JSON.stringify(result, null, 2));
    console.log(`Seeded ${result.database}: ${result.users.length} users, 3 test cases.`);
    console.log(`Wrote ${path.relative(process.cwd(), out)}`);
  })
  .catch(async (error) => {
    await prisma.$disconnect();
    console.error(error);
    process.exit(1);
  });
