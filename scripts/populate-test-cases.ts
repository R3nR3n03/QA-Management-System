/**
 * Bulk test-case generator, for giving the list screens a realistic corpus to page,
 * filter and measure against.
 *
 * Usage:  COUNT=1000 npx tsx scripts/populate-test-cases.ts
 *
 * ## Everything goes through the domain services
 *
 * `createTestCase` -> `replaceSteps` -> `submitTestCase` -> `approveTestCase`, never
 * Prisma directly. `docs/architecture.md:30` and `CLAUDE.md` both forbid writing around
 * the services, and the point of obeying that here is that the generated corpus is
 * indistinguishable from hand-entered data: RBAC ran, the hierarchy was validated,
 * priority and severity were checked against the active `ControlledValue` rows, each
 * `TC-<PRODUCT>-####` came from the real allocator, and every mutation left its
 * `AuditEvent`. Seed data that skipped those would silently be a different shape from
 * the data the application actually produces.
 *
 * ## The lifecycle spread is deliberate
 *
 * Roughly 40% Draft / 20% In Review / 40% Approved rather than a flat pile of drafts:
 * an all-Draft corpus leaves `/review` empty and makes execution planning impossible,
 * because only an Approved case can be executed. The author is a QA Engineer and the
 * approver is the QA Lead — they MUST be different people, `roles-workflows.md:26`
 * forbids approving a case you authored, and the domain enforces it.
 *
 * ## Limits worth knowing before raising COUNT
 *
 * Business IDs are a four-digit space per product (`docs/data-model.md`), so allocation
 * past `TC-<PRODUCT>-9999` is refused — `formatBusinessId` throws, and a COUNT that
 * crosses the ceiling stops partway with the cases already created left in place.
 * Nothing here is transactional across cases, by design: each case is its own create,
 * exactly as if it had been entered one at a time.
 */
// Must precede the db import: `src/lib/db` reads DATABASE_URL at module scope.
import "dotenv/config";
import { QamsRole } from "@prisma/client";
import { prisma } from "../src/lib/db";
import { createTestCase, replaceSteps, submitTestCase, approveTestCase } from "../src/domain/test-cases";

/**
 * Refused rather than defaulted: `Number("lots")` is NaN, and a NaN bound makes the loop
 * body never run, so a typo would report success having created nothing.
 */
function parseCount(raw: string | undefined): number {
  if (raw === undefined) return 1000;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`COUNT must be a positive integer; got ${JSON.stringify(raw)}.`);
  }
  return parsed;
}

const COUNT = parseCount(process.env.COUNT);

/** Deterministic PRNG so a re-run with the same COUNT produces the same corpus. */
function makeRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}
const rand = makeRandom(20260803);
const pick = <T,>(items: readonly T[]): T => items[Math.floor(rand() * items.length)];

const AREAS = [
  "login", "session timeout", "password reset", "role assignment", "audit trail",
  "test case approval", "execution finalize", "defect triage", "defect closure",
  "workbook import", "traceability link", "dashboard metrics", "release readiness",
  "pagination", "search filter", "controlled values", "optimistic locking",
  "hierarchy validation", "business ID allocation", "session revocation"
] as const;
const VERBS = [
  "rejects", "accepts", "records", "surfaces", "blocks", "allows", "validates",
  "audits", "reports", "preserves"
] as const;
const CONDITIONS = [
  "with valid input", "with a blank required field", "when the version is stale",
  "for an unauthorised role", "at the documented boundary", "after a concurrent edit",
  "when the referenced record is missing", "with mixed-case input",
  "under the rate limit", "once the record is immutable"
] as const;

const CYCLES = ["Cycle 1", "Cycle 2", "Cycle 3", "Cycle 4"] as const;
const SPRINTS = Array.from({ length: 12 }, (_, i) => `Sprint ${i + 1}`);
const RELEASES = ["R1.0", "R1.1", "R2.0", "R2.1"] as const;
const ENVIRONMENTS = ["SIT", "UAT", "Staging", "Pre-Prod"] as const;
const PRIORITIES = ["High", "Medium", "Low"] as const;
const SEVERITIES = ["Critical", "Major", "Minor"] as const;

async function main() {
  // The hierarchy every generated case hangs off — whatever chain already exists.
  const requirement = await prisma.requirement.findFirst({
    include: { feature: { include: { module: { include: { product: true } } } } },
    orderBy: { businessId: "asc" }
  });
  if (!requirement) throw new Error("No Requirement exists — run `npm run demo:data` first.");

  const author = await prisma.user.findFirst({ where: { role: QamsRole.QA_ENGINEER, active: true } });
  const lead = await prisma.user.findFirst({ where: { role: QamsRole.QA_LEAD, active: true } });
  if (!author || !lead) throw new Error("Need an active QA_ENGINEER and QA_LEAD.");

  const authorActor = { userId: author.id, role: author.role, requestId: "populate-test-cases" };
  const leadActor = { userId: lead.id, role: lead.role, requestId: "populate-test-cases" };

  const hierarchy = {
    productId: requirement.feature.module.product.id,
    moduleId: requirement.feature.module.id,
    featureId: requirement.feature.id,
    requirementId: requirement.id
  };

  console.log(
    `Authoring ${COUNT} cases as ${author.email} under ` +
      `${requirement.feature.module.product.businessId}/${requirement.businessId}`
  );

  const tally = { DRAFT: 0, IN_REVIEW: 0, APPROVED: 0 };
  const started = Date.now();

  for (let i = 1; i <= COUNT; i += 1) {
    const area = pick(AREAS);
    const created = await createTestCase(
      {
        ...hierarchy,
        cycle: pick(CYCLES),
        sprint: pick(SPRINTS),
        release: pick(RELEASES),
        environment: pick(ENVIRONMENTS),
        priority: pick(PRIORITIES),
        severity: pick(SEVERITIES),
        title: `Verify ${area} ${pick(VERBS)} ${pick(CONDITIONS)}`,
        objective: `Confirm the ${area} behaviour holds ${pick(CONDITIONS)}.`,
        expectedResult: `The system ${pick(VERBS)} the request and the outcome is recorded.`
      },
      authorActor
    );

    // Steps first: a case cannot be submitted without at least one.
    const stepped = await replaceSteps(
      created.id,
      [
        { sequence: 1, action: `Open the ${area} screen as an authorised user.`, expectedResult: "The screen loads." },
        { sequence: 2, action: `Exercise ${area} ${pick(CONDITIONS)}.`, expectedResult: `The system ${pick(VERBS)} it.` },
        { sequence: 3, action: "Re-read the record and the audit trail.", expectedResult: "Both agree with the action taken." }
      ],
      created.version,
      authorActor
    );

    // A spread of lifecycle states, so the review queue and execution planning have
    // something to work with. Author submits their own; the LEAD approves, because
    // roles-workflows.md:26 forbids approving a case you authored.
    const roll = rand();
    if (roll < 0.4) {
      tally.DRAFT += 1;
    } else {
      const submitted = await submitTestCase(stepped.id, stepped.version, authorActor);
      if (roll < 0.6) {
        tally.IN_REVIEW += 1;
      } else {
        await approveTestCase(submitted.id, submitted.version, leadActor);
        tally.APPROVED += 1;
      }
    }

    if (i % 100 === 0 || i === COUNT) {
      const rate = i / ((Date.now() - started) / 1000);
      console.log(`  ${i}/${COUNT}  (${rate.toFixed(1)}/s)`);
    }
  }

  console.log("Done:", tally, `in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error("FAILED:", error);
  await prisma.$disconnect();
  process.exit(1);
});
