/**
 * One-off migration of `Return_Transaction_Test_Cases.xlsx` into the catalogue.
 *
 * This workbook is NOT the seed workbook of `docs/excel-source-map.md` — it has a single
 * `Test Cases` sheet (`#`, `Test Case`, `Preconditions`, `Steps`, `Expected Result`), so
 * `createImportRun` refuses it before any write. It is therefore migrated as *authored*
 * content rather than seed history: every case enters DRAFT through `createTestCase`, the
 * ordinary lifecycle, and none of it takes the seed-import exception that would land it in
 * APPROVED without review (`docs/roles-workflows.md` § "Test-case lifecycle").
 *
 * Everything is written THROUGH the domain services, per `docs/architecture.md:30`. The
 * only direct Prisma reads here resolve business IDs to row IDs and make the script
 * re-runnable.
 *
 * The values the source does not carry — hierarchy, cycle/sprint/release/environment,
 * priority/severity, and the requirement statement — were decided by the QA Lead
 * (Renmark, 2026-08-11) and are recorded in the constants below rather than inferred.
 *
 *   npx tsx scripts/import-return-transaction-cases.ts [--dry-run]
 */

import "dotenv/config";
import * as XLSX from "xlsx";
import { QamsRole } from "@prisma/client";
import { prisma } from "../src/lib/db";
import { createFeature, createRequirement } from "../src/domain/catalogue";
import { createTestCase, replaceSteps } from "../src/domain/test-cases";

const SOURCE_FILE = "C:/Users/ASINC-RPANES/Downloads/Return_Transaction_Test_Cases.xlsx";
const SOURCE_SHEET = "Test Cases";

/** QA Lead decisions, 2026-08-11. Not derivable from the source workbook. */
const ANCHOR_MODULE = "MOD009"; // Sales, under PROD003 POS
const FEATURE_NAME = "Return Transaction";
const REQUIREMENT_STATEMENT =
  "Process return transactions for sales originating on any POS terminal or through Order " +
  "Capture, including cross-terminal and cross-channel transaction lookup, refund routing to " +
  "the original payment method, partial and full returns, loyalty and promotion reversal, " +
  "return-window and permission enforcement, duplicate return prevention, offline and " +
  "sync-delay handling, and audit logging on both the origin and processing terminals.";
const RUN_CONTEXT = {
  cycle: "Cycle 1",
  sprint: "Sprint 51",
  release: "R3.2.65",
  environment: "Pre-Prod"
};

/**
 * Priority and severity by source row `#`. The source sheet has neither column, and both
 * are required before a case can be submitted for review
 * (`docs/business-rules-and-validation.md:20`) — so they are a QA Lead judgement recorded
 * here, not a value read from the workbook.
 */
const TRIAGE: Record<number, { priority: string; severity: string }> = {
  1: { priority: "High", severity: "Critical" },
  2: { priority: "High", severity: "Critical" },
  3: { priority: "High", severity: "Critical" },
  4: { priority: "High", severity: "Critical" },
  5: { priority: "High", severity: "Critical" },
  6: { priority: "High", severity: "Critical" },
  7: { priority: "High", severity: "Major" },
  8: { priority: "High", severity: "Major" },
  9: { priority: "High", severity: "Major" },
  10: { priority: "Medium", severity: "Major" },
  11: { priority: "High", severity: "Major" },
  12: { priority: "Medium", severity: "Major" },
  13: { priority: "Medium", severity: "Major" },
  14: { priority: "Medium", severity: "Minor" },
  15: { priority: "High", severity: "Critical" },
  16: { priority: "Medium", severity: "Major" },
  17: { priority: "Medium", severity: "Major" },
  18: { priority: "High", severity: "Major" },
  19: { priority: "Medium", severity: "Major" },
  20: { priority: "Medium", severity: "Major" }
};

const dryRun = process.argv.includes("--dry-run");

type SourceRow = {
  number: number;
  title: string;
  preconditions: string;
  steps: string;
  expectedResult: string;
};

/** Trim and collapse internal whitespace, matching the importer's `normalizeHeader`. */
function clean(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function readSource(): SourceRow[] {
  const workbook = XLSX.readFile(SOURCE_FILE);
  const worksheet = workbook.Sheets[SOURCE_SHEET];
  if (!worksheet) {
    throw new Error(`Sheet "${SOURCE_SHEET}" not found in ${SOURCE_FILE}.`);
  }
  const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, blankrows: false, defval: "" });
  const header = (rows[0] ?? []).map(clean);
  const expected = ["#", "Test Case", "Preconditions", "Steps", "Expected Result"];
  for (const column of expected) {
    if (!header.includes(column)) {
      throw new Error(`Source sheet is missing the "${column}" column; found: ${header.join(", ")}.`);
    }
  }
  const at = (row: unknown[], column: string) => clean(row[header.indexOf(column)]);

  const out: SourceRow[] = [];
  for (const row of rows.slice(1)) {
    const title = at(row, "Test Case");
    if (!title) continue;
    out.push({
      number: Number(at(row, "#")),
      title,
      preconditions: at(row, "Preconditions"),
      steps: at(row, "Steps"),
      expectedResult: at(row, "Expected Result")
    });
  }
  return out;
}

async function main() {
  const source = readSource();
  console.log(`Read ${source.length} test cases from ${SOURCE_FILE}`);

  const missingTriage = source.filter((row) => !TRIAGE[row.number]);
  if (missingTriage.length > 0) {
    throw new Error(
      `No priority/severity recorded for source row(s): ${missingTriage.map((r) => r.number).join(", ")}. ` +
        "Every row needs a QA Lead decision before it can be written."
    );
  }
  const blank = source.filter((row) => !row.preconditions || !row.steps || !row.expectedResult);
  if (blank.length > 0) {
    throw new Error(
      `Source row(s) ${blank.map((r) => r.number).join(", ")} have a blank Preconditions, Steps, or ` +
        "Expected Result cell; all three are required and none may be invented."
    );
  }

  const actorUser = await prisma.user.findUnique({ where: { email: "renmark@qa.com" } });
  if (!actorUser) throw new Error("Actor user renmark@qa.com was not found.");
  if (actorUser.role !== QamsRole.QA_LEAD) {
    throw new Error(`Actor must be a QA Lead to create catalogue rows; renmark@qa.com is ${actorUser.role}.`);
  }
  const actor = {
    userId: actorUser.id,
    role: actorUser.role,
    requestId: "return-tx-migration-2026-08-11"
  };

  const anchorModule = await prisma.module.findUnique({
    where: { businessId: ANCHOR_MODULE },
    include: { product: true }
  });
  if (!anchorModule) throw new Error(`Module ${ANCHOR_MODULE} was not found.`);
  console.log(`Anchor: ${anchorModule.product.businessId} ${anchorModule.product.name} > ${anchorModule.businessId} ${anchorModule.name}`);

  if (dryRun) {
    console.log("\n--- DRY RUN, nothing written ---");
    for (const row of source) {
      const triage = TRIAGE[row.number];
      console.log(`\n#${row.number} [${triage.priority}/${triage.severity}] ${row.title}`);
      console.log(`  objective: ${row.preconditions}`);
      console.log(`  step 1:    ${row.steps}`);
      console.log(`  expected:  ${row.expectedResult}`);
    }
    return;
  }

  // Feature — reused if a previous run already made it, so the script is re-runnable.
  let feature = await prisma.feature.findFirst({
    where: { moduleId: anchorModule.id, name: FEATURE_NAME }
  });
  if (feature) {
    console.log(`Feature ${feature.businessId} "${feature.name}" already exists; reusing.`);
  } else {
    feature = await createFeature({ name: FEATURE_NAME, moduleId: anchorModule.id }, actor);
    console.log(`Created feature ${feature.businessId} "${feature.name}"`);
  }

  // Requirement.
  let requirement = await prisma.requirement.findFirst({
    where: { featureId: feature.id, statement: REQUIREMENT_STATEMENT }
  });
  if (requirement) {
    console.log(`Requirement ${requirement.businessId} already exists; reusing.`);
  } else {
    requirement = await createRequirement(
      { statement: REQUIREMENT_STATEMENT, featureId: feature.id },
      actor
    );
    console.log(`Created requirement ${requirement.businessId}`);
  }

  // Test cases + their single step.
  let created = 0;
  let skipped = 0;
  for (const row of source) {
    const triage = TRIAGE[row.number];
    const already = await prisma.testCase.findFirst({
      where: { requirementId: requirement.id, title: row.title }
    });
    if (already) {
      console.log(`  #${String(row.number).padStart(2)} SKIP    ${already.businessId} already exists`);
      skipped += 1;
      continue;
    }

    const testCase = await createTestCase(
      {
        productId: anchorModule.productId,
        moduleId: anchorModule.id,
        featureId: feature.id,
        requirementId: requirement.id,
        cycle: RUN_CONTEXT.cycle,
        sprint: RUN_CONTEXT.sprint,
        release: RUN_CONTEXT.release,
        environment: RUN_CONTEXT.environment,
        priority: triage.priority,
        severity: triage.severity,
        title: row.title,
        // House style: `objective` carries the setup precondition (see TC-PROD002-0001).
        objective: row.preconditions,
        expectedResult: row.expectedResult
      },
      actor
    );

    // One source row describes one action, so the case gets one step, and that final step
    // repeats the expected result exactly as the existing cases do (TC-PROD002-0079).
    await replaceSteps(
      testCase.id,
      [{ sequence: 1, action: row.steps, expectedResult: row.expectedResult }],
      testCase.version,
      actor
    );

    console.log(`  #${String(row.number).padStart(2)} CREATED ${testCase.businessId} [${triage.priority}/${triage.severity}] ${row.title}`);
    created += 1;
  }

  console.log(`\nDone. ${created} created, ${skipped} skipped (already present).`);
  console.log(`All cases are DRAFT under ${feature.businessId} / ${requirement.businessId}, authored by ${actorUser.displayName}.`);
}

main()
  .catch((error) => {
    console.error("\nFAILED:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
