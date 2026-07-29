import "dotenv/config";
import { PrismaClient, QamsRole } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "../src/lib/password";
import { buildControlledValueSeedRows } from "../src/lib/controlled-value-catalogues";

const adapter = new PrismaPg(process.env.DATABASE_URL as string);
const prisma = new PrismaClient({ adapter });

const SEED_ACTOR = "seed";

/**
 * Bootstraps the controlled-value catalogues documented in
 * `docs/excel-source-map.md` § "Source-controlled values". Runs unconditionally and
 * has no environment-variable dependency: without these rows, createTestCase /
 * createDefect / submit / approve / triage all reject every input with 422
 * CONTROLLED_VALUE_INVALID, so a database without them is unusable.
 */
async function seedControlledValues(client: PrismaClient) {
  const rows = buildControlledValueSeedRows(SEED_ACTOR);
  let created = 0;

  for (const row of rows) {
    const key = { catalogue_value: { catalogue: row.catalogue, value: row.value } };

    // Read first purely to report an accurate created/skipped count; the write below
    // is still a single atomic upsert, so a concurrent run cannot cause a duplicate.
    const existing = await client.controlledValue.findUnique({ where: key });

    await client.controlledValue.upsert({
      where: key,
      create: {
        catalogue: row.catalogue,
        value: row.value,
        createdBy: row.createdBy,
        updatedBy: row.updatedBy
      },
      // Deliberately a no-op. Do NOT "fix" this by writing `active: true` here:
      // a QA Lead may have intentionally deactivated a value via
      // PATCH /controlled-values, and re-running the seed must never resurrect it.
      update: {}
    });

    if (!existing) created += 1;
  }

  console.log(
    `Controlled values: ${created} created, ${rows.length - created} already present (${rows.length} total).`
  );
}

/**
 * Creates the bootstrap QA Lead. Returns instead of throwing when it cannot run, so
 * that a missing password or an already-seeded user never aborts the rest of the seed.
 */
async function seedQaLeadUser(client: PrismaClient) {
  const email = process.env.SEED_QA_LEAD_EMAIL ?? "qa.lead@example.com";
  const password = process.env.SEED_QA_LEAD_PASSWORD;
  if (!password) {
    console.log("SEED_QA_LEAD_PASSWORD is not set; skipping bootstrap QA Lead user.");
    return;
  }

  const existing = await client.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Seed user ${email} already exists; skipping.`);
    return;
  }

  const user = await client.user.create({
    data: {
      email,
      displayName: "Seed QA Lead",
      passwordHash: hashPassword(password),
      role: QamsRole.QA_LEAD,
      createdBy: SEED_ACTOR,
      updatedBy: SEED_ACTOR
    }
  });

  console.log(`Created bootstrap QA Lead user ${user.email} (${user.id}).`);
}

async function main() {
  await seedControlledValues(prisma);
  await seedQaLeadUser(prisma);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
